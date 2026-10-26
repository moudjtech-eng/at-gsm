const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// Config de l'expéditeur (utilise tes variables .env)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendReceiptEmail(member, payment) {
  // On génère le PDF dans un Buffer en mémoire
  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', async () => {
    const pdfData = Buffer.concat(buffers);

    // Envoi de l'email
    const mailOptions = {
      from: '"AT-GSM Bohicon" <noreply@atgsm.bj>',
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
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`📧 Reçu envoyé à ${member.email}`);
    } catch (error) {
      console.error("Erreur d'envoi d'email:", error);
    }
  });

  // On redessine le PDF dans ce buffer
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
  
  doc.end();
}

async function sendAdminNotificationEmail(adminEmail, memberName, amount, months, ref) {
  const mailOptions = {
    from: '"Système AT-GSM" <noreply@atgsm.bj>',
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
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Notification Admin envoyée à ${adminEmail}`);
  } catch (error) {
    console.error("Erreur d'envoi d'email admin:", error);
  }
}

async function sendReminderEmail(memberEmail, memberName, debtMonths, amount) {
  const mailOptions = {
    from: '"AT-GSM Bohicon" <noreply@atgsm.bj>',
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
          <a href="http://localhost:3000/member" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Payer mes cotisations</a>
        </div>
        <p style="color: #666; font-size: 12px;">Si vous pensez qu'il s'agit d'une erreur, veuillez contacter l'administration.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Erreur d'envoi d'email de relance:", error);
    return false;
  }
}

module.exports = { sendReceiptEmail, sendAdminNotificationEmail, sendReminderEmail };