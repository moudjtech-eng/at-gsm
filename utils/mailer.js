const { Resend } = require('resend');
const PDFDocument = require('pdfkit');

// Initialisation de Resend avec la clé API depuis le fichier .env
const resend = new Resend(process.env.RESEND_API_KEY);

// L'adresse d'envoi (Resend fournit onboarding@resend.dev pour les tests)
// ⚠️ En production, tu devras vérifier ton propre domaine (ex: contact@atgsm.bj)
const FROM_EMAIL = 'AT-GSM Bohicon <onboarding@resend.dev>';

// --- 1. ENVOI DU REÇU (AVEC FACTURE PDF) ---
async function sendReceiptEmail(member, payment) {
  return new Promise((resolve, reject) => {
    // On génère le PDF dans un Buffer en mémoire
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    
    // On collecte les morceaux du PDF au fur et à mesure
    doc.on('data', buffers.push.bind(buffers));
    
    // Quand le PDF est terminé, on envoie l'email
    doc.on('end', async () => {
      const pdfData = Buffer.concat(buffers);

      try {
        const data = await resend.emails.send({
          from: FROM_EMAIL,
          to: member.email,
          subject: `Votre reçu de paiement AT-GSM - #${payment.ref}`,
          html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
              <h2 style="color: #dc2626;">Merci pour votre paiement !</h2>
              <p>Bonjour <strong>${member.name}</strong>,</p>
              <p>Nous avons bien reçu votre paiement de <strong>${payment.amount.toLocaleString('fr-FR')} FCFA</strong> pour ${payment.months} mois de cotisation.</p>
              <p>Vous trouverez votre facture officielle en pièce jointe de cet email.</p>
              <br>
              <p>L'équipe AT-GSM Bohicon.</p>
            </div>
          `,
          attachments: [
            {
              filename: `facture-${payment.ref}.pdf`,
              content: pdfData
            }
          ]
        });
        console.log(`📧 Reçu envoyé à ${member.email} (ID: ${data.data?.id})`);
        resolve(true);
      } catch (error) {
        console.error("Erreur d'envoi d'email via Resend:", error);
        resolve(false);
      }
    });

    // --- DESSIN DU PDF ---
    doc.fontSize(20).font('Helvetica-Bold').text('AT-GSM BOHICON', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Association des Techniciens GSM', { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, 100).lineTo(550, 100).stroke();
    
    doc.fontSize(12).font('Helvetica-Bold').text('FACTURE', 50, 120);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Référence : #${payment.ref}`, 50, 140);
    doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 50, 155);
    
    doc.fontSize(12).font('Helvetica-Bold').text('Facturé à :', 350, 120);
    doc.fontSize(10).font('Helvetica').text(member.name, 350, 140);
    doc.text(member.spec || '', 350, 155);
    doc.text(member.phone || '', 350, 170);
    
    const tableTop = 220;
    doc.font('Helvetica-Bold').text('Désignation', 50, tableTop).text('Mois', 300, tableTop).text('Montant', 450, tableTop, { align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
    
    doc.font('Helvetica').text('Cotisation AT-GSM', 50, tableTop + 30).text(`${payment.months} mois`, 300, tableTop + 30).text(`${payment.amount.toLocaleString('fr-FR')} FCFA`, 450, tableTop + 30, { align: 'right' });
    doc.moveTo(50, tableTop + 50).lineTo(550, tableTop + 50).stroke();
    
    doc.font('Helvetica-Bold').text('TOTAL :', 350, tableTop + 70).text(`${payment.amount.toLocaleString('fr-FR')} FCFA`, 450, tableTop + 70, { align: 'right' });
    
    // On termine le PDF
    doc.end();
  });
}

// --- 2. NOTIFICATION À L'ADMIN ---
async function sendAdminNotificationEmail(adminEmail, memberName, amount, months, ref) {
  try {
    await resend.emails.send({
      from: 'Système AT-GSM <onboarding@resend.dev>',
      to: adminEmail,
      subject: `💰 Nouveau paiement reçu de ${memberName}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #dc2626;">Nouveau paiement validé !</h2>
          <p>Bonjour Admin,</p>
          <p>Le membre <strong>${memberName}</strong> vient d'effectuer un paiement via KkiaPay.</p>
          <ul>
            <li><strong>Montant :</strong> ${amount.toLocaleString('fr-FR')} FCFA</li>
            <li><strong>Nombre de mois :</strong> ${months}</li>
            <li><strong>Référence :</strong> ${ref}</li>
          </ul>
          <p>Vous pouvez retrouver ce paiement dans votre tableau de bord.</p>
        </div>
      `
    });
    console.log(`📧 Notification Admin envoyée à ${adminEmail}`);
    return true;
  } catch (error) {
    console.error("Erreur d'envoi d'email admin via Resend:", error);
    return false;
  }
}

// --- 3. RELANCE POUR RETARD DE PAIEMENT ---
async function sendReminderEmail(memberEmail, memberName, debtMonths, amount) {
  // URL de ton site (à changer quand tu seras en production)
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: memberEmail,
      subject: `⚠️ Rappel : Cotisations en retard - AT-GSM Bohicon`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #dc2626; text-align: center;">AT-GSM Bohicon</h2>
          <p>Bonjour <strong>${memberName}</strong>,</p>
          <p>Nous vous contactons car notre système indique que vous avez <strong>${debtMonths} mois de retard</strong> dans le paiement de vos cotisations.</p>
          <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; font-size: 18px; font-weight: bold; color: #dc2626;">Montant dû : ${amount.toLocaleString('fr-FR')} FCFA</p>
          </div>
          <p>Pour rester un membre actif et continuer à bénéficier des avantages de l'association, nous vous invitons à régulariser votre situation en vous connectant à votre espace personnel.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${siteUrl}/member" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Payer mes cotisations</a>
          </div>
          <p style="color: #666; font-size: 12px;">Si vous pensez qu'il s'agit d'une erreur, veuillez contacter l'administration.</p>
        </div>
      `
    });
    return true;
  } catch (error) {
    console.error("Erreur d'envoi d'email de relance via Resend:", error);
    return false;
  }
}

module.exports = { sendReceiptEmail, sendAdminNotificationEmail, sendReminderEmail };