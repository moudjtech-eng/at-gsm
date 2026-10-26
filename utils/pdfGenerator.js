const PDFDocument = require('pdfkit');

function generateReceiptPDF(member, payment, res) {
  const doc = new PDFDocument({ margin: 50 });

  // Envoi direct au navigateur ou dans un buffer
  if (res) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=facture-${payment.ref}.pdf`);
    doc.pipe(res);
  }

  // En-tête
  doc.fontSize(20).font('Helvetica-Bold').text('AT-GSM BOHICON', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text('Association des Techniciens GSM', { align: 'center' });
  doc.moveDown();

  // Ligne
  doc.moveTo(50, 100).lineTo(550, 100).stroke();

  // Infos Facture
  doc.fontSize(12).font('Helvetica-Bold').text('FACTURE', 50, 120);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Référence : #${payment.ref}`, 50, 140);
  doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 50, 155);

  // Infos Client
  doc.fontSize(12).font('Helvetica-Bold').text('Facturé à :', 350, 120);
  doc.fontSize(10).font('Helvetica');
  doc.text(member.name, 350, 140);
  doc.text(member.spec || '', 350, 155);
  doc.text(member.phone || '', 350, 170);

  // Tableau
  const tableTop = 220;
  doc.font('Helvetica-Bold');
  doc.text('Désignation', 50, tableTop);
  doc.text('Mois', 300, tableTop);
  doc.text('Montant', 450, tableTop, { align: 'right' });

  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

  // Ligne du tableau
  doc.font('Helvetica');
  doc.text('Cotisation AT-GSM', 50, tableTop + 30);
  doc.text(`${payment.months} mois`, 300, tableTop + 30);
  doc.text(`${payment.amount.toLocaleString('fr-FR')} FCFA`, 450, tableTop + 30, { align: 'right' });

  doc.moveTo(50, tableTop + 50).lineTo(550, tableTop + 50).stroke();

  // Total
  doc.font('Helvetica-Bold');
  doc.text('TOTAL :', 350, tableTop + 70);
  doc.text(`${payment.amount.toLocaleString('fr-FR')} FCFA`, 450, tableTop + 70, { align: 'right' });

  // Statut
  doc.fontSize(12).fillColor('green').text('PAYÉ ET VALIDÉ', 50, tableTop + 110, { align: 'center' });
  
  doc.end();
  
  return doc; // Si on n'utilise pas res pour streamer directement
}

module.exports = { generateReceiptPDF };