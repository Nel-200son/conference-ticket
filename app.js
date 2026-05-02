
var CONFIG = {
  kkiapay_key: 'pk_sandbox_z8sJl3QVIa1VLIsAdG1S9aan',
  kkiapay_sandbox: false,
  resend_api_key: 're_GUWkEbnS_NwaoLVgHWLqrUg6xRtRJ9h5G',
  email_from: 'billets@excellence-en-action.bj',
  email_from_name: 'Excellence en Action',
  supabase_url: 'https://gibnmpvthoacomhcnawj.supabase.co',
  supabase_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpYm5tcHZ0aG9hY29taGNuYXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NDM5MzIsImV4cCI6MjA5MzIxOTkzMn0.BFeJWPfJgwmNejo_ZNpR7wJKbLzo90mj2lKxhCbnm4Q'
};

const supabaseClient = supabase.createClient(CONFIG.supabase_url, CONFIG.supabase_key);

var pass = {name:'',price:'',amount:0,features:[]};
var buyer = {};
var selectedPayment = 'mtn';
var lastTransactionId = '';
var pdfDataUrl = '';

function selectPass(card, name, price, amount, features) {
  document.querySelectorAll('.pass-card').forEach(function(c){c.classList.remove('selected');});
  card.classList.add('selected');
  pass = {name:name, price:price, amount:amount, features:features};
  document.getElementById('summary-name').textContent = 'Pass ' + name;
  document.getElementById('summary-price').textContent = price + ' FCFA';
  document.getElementById('btn-price').textContent = price;
  var checkout = document.getElementById('checkout');
  checkout.classList.add('active');
  setTimeout(function(){ checkout.scrollIntoView({behavior:'smooth',block:'start'}); }, 100);
}

function selectPayment(method) {
  selectedPayment = method;
  document.querySelectorAll('.payment-method').forEach(function(el){el.classList.remove('active');});
  document.getElementById('pm-' + method).classList.add('active');
}

function handlePayment() {
  var prenom = document.getElementById('prenom').value.trim();
  var nom    = document.getElementById('nom').value.trim();
  var email  = document.getElementById('email').value.trim();
  var phone  = document.getElementById('phone').value.trim();
  var mode   = document.querySelector('input[name="mode"]:checked').value;
  if (!prenom || !nom) { alert('Veuillez entrer votre prenom et nom.'); return; }
  if (!email || email.indexOf('@') < 0) { alert('Adresse e-mail invalide.'); return; }
  if (!phone || phone.length < 6) { alert('Numero de telephone requis.'); return; }
  if (!pass.amount) { alert('Veuillez choisir un pass.'); return; }
  buyer = {prenom:prenom, nom:nom, email:email, phone:phone, mode:mode, pays:document.getElementById('pays').value};
  
  
// 2. Remplacer openKkiapayWidget(...) par :
FedaPay.init({
  public_key: CONFIG.kkiapay_key,
  transaction: {
    amount: pass.amount,
    description: 'Pass ' + pass.name + ' - Conference au Benin 2026'
  },
  customer: {
    email: buyer.email,
    lastname: buyer.nom,
    firstname: buyer.prenom,
    phone_number: { number: buyer.phone, country: 'BJ' }
  },
  onComplete: function(transaction) {
    if (transaction.reason === FedaPay.DIALOG_DISMISSED) return;
    lastTransactionId = transaction.id || ('FA-' + Date.now());
    showLoading();
    runPostPayment();
  }
}).open();

}

window.addEventListener('kkiapay-payment-success', function(event) {
  lastTransactionId = (event.detail && event.detail.transactionId) ? event.detail.transactionId : ('FA-' + Date.now());
  showLoading();
  runPostPayment();
});

window.addEventListener('kkiapay-payment-failed', function() {
  alert('Paiement echoue ou annule. Veuillez reessayer ou contacter le +229 0163 350 339.');
});

function runPostPayment() {
  setStep('step-pay','done');
  setStep('step-pdf','active-step');
  
  // Enregistrement dans Supabase
  saveParticipantToDB();

  Promise.all([generateQR(), fetchImageAsBase64('bg.png')]).then(function(results) {
    var qrImg = results[0];
    var bgImg = results[1];
    return generateTicketPDF(qrImg, bgImg).then(function(pdf) {
      pdfDataUrl = pdf;
      setStep('step-pdf','done');
      setStep('step-email','active-step');
      return sendEmailViaResend(pdf, qrImg);
    });
  }).then(function() {
    setStep('step-email','done');
    setTimeout(function(){ hideLoading(); showSuccess(); }, 800);
  }).catch(function(err) {
    console.error('Erreur:', err);
    hideLoading();
    showSuccess();
    alert('Paiement confirme. Probleme envoi email - telechargez votre billet sur cette page.');
  });
}

function fetchImageAsBase64(url) {
  return fetch(url)
    .then(function(res) { return res.blob(); })
    .then(function(blob) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function() { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }).catch(function(e) {
      console.warn("Could not load background image", e);
      return null;
    });
}

function generateQR() {
  return new Promise(function(resolve) {
    var container = document.getElementById('qr-hidden');
    container.innerHTML = '';
    var qrDiv = document.createElement('div');
    container.appendChild(qrDiv);
    var qrUrl = 'https://conftick.netlify.app/verify.html' 
      + '?ref=' + lastTransactionId 
      + '&nom=' + encodeURIComponent(buyer.prenom + ' ' + buyer.nom)
      + '&pass=' + pass.name
      + '&mode=' + encodeURIComponent(buyer.mode)
      + '&sig=' + btoa(lastTransactionId).substring(0,12);
    new QRCode(qrDiv, {text:qrUrl, width:200, height:200, colorDark:'#0D0A06', colorLight:'#FFFFFF', correctLevel:QRCode.CorrectLevel.H});
    setTimeout(function() {
      var canvas = qrDiv.querySelector('canvas');
      resolve(canvas ? canvas.toDataURL('image/png') : '');
    }, 300);
  });
}

async function saveParticipantToDB() {
  try {
    const { data, error } = await supabaseClient
      .from('participants')
      .insert([
        { 
          reference: lastTransactionId, 
          prenom: buyer.prenom, 
          nom: buyer.nom,
          email: buyer.email,
          phone: buyer.phone,
          pass_type: pass.name,
          amount: pass.amount,
          mode: buyer.mode,
          pays: buyer.pays
        }
      ]);
    if (error) throw error;
    console.log('Participant enregistré avec succès');
  } catch (err) {
    console.error('Erreur Supabase:', err.message);
  }
}

function generateTicketPDF(qrImg, bgImg) {
  return new Promise(function(resolve) {
    var jsPDF = window.jspdf.jsPDF;
    var GState = window.jspdf.GState;
    var doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a5'});
    var W = 148, H = 210;

    if (bgImg) {
      doc.addImage(bgImg, 'PNG', 0, 0, W, H);
      if (GState) doc.setGState(new GState({opacity: 0.85}));
      doc.setFillColor(49,32,17); doc.rect(0,0,W,H,'F'); // Dominance marron
      if (GState) doc.setGState(new GState({opacity: 1.0}));
    } else {
      doc.setFillColor(49,32,17); doc.rect(0,0,W,H,'F');
    }

    doc.setFillColor(0,154,68); doc.rect(0,0,5,H/3,'F');
    doc.setFillColor(200,16,46); doc.rect(0,H/3,5,H/3,'F');
    doc.setFillColor(252,209,22); doc.rect(0,(H/3)*2,5,H/3,'F');
    doc.setDrawColor(212,160,23); doc.setLineWidth(0.8); doc.rect(8,8,W-16,H-16);

    doc.setFontSize(9); doc.setTextColor(212,160,23); doc.setFont('helvetica','bold');
    doc.text('EXCELLENCE EN ACTION', W/2, 18, {align:'center'});
    doc.setFontSize(7); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text("l'Excellence en Action - FA", W/2, 23, {align:'center'});

    doc.setFontSize(18); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
    doc.text('CONFERENCE', W/2, 36, {align:'center'});
    doc.setFontSize(22); doc.setTextColor(212,160,23);
    doc.text('AU BENIN', W/2, 46, {align:'center'});
    doc.setFontSize(8); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('2026', W/2, 52, {align:'center'});

    doc.setDrawColor(212,160,23); doc.setLineWidth(0.4); doc.line(15,56,W-15,56);

    doc.setFillColor(50,38,10); doc.setDrawColor(212,160,23); doc.setLineWidth(0.5);
    doc.roundedRect(15,60,W-30,16,2,2,'FD');
    doc.setFontSize(7); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('PASS', W/2, 66, {align:'center'});
    
    doc.setFontSize(14);
    var pName = pass.name.toUpperCase();
    if (pName === 'DECOUVERTE') doc.setTextColor(138, 155, 176);
    else if (pName === 'ASCENSION') doc.setTextColor(212, 160, 23);
    else if (pName === 'IMPACT') doc.setTextColor(200, 16, 46);
    else if (pName === 'INCONTOURNABLE') doc.setTextColor(0, 154, 68);
    else doc.setTextColor(255, 255, 255);
    
    doc.setFont('helvetica','bold');
    doc.text(pName, W/2, 73, {align:'center'});

    doc.setFontSize(7); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('NOM DU PARTICIPANT', 15, 86);
    doc.setFontSize(11); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
    doc.text(buyer.prenom + ' ' + buyer.nom, 15, 92);

    doc.setFontSize(7); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('DATE', 15, 102); doc.text('LIEU', W/2, 102);
    doc.setFontSize(9); doc.setTextColor(212,160,23); doc.setFont('helvetica','bold');
    doc.text('11 Juillet 2026', 15, 108); doc.text('Benin Royal Hotel', W/2, 108);

    doc.setFontSize(7); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('MODE', 15, 116); doc.text('MONTANT', W/2, 116);
    doc.setFontSize(9); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold');
    doc.text(buyer.mode, 15, 122); doc.text(pass.price + ' FCFA', W/2, 122);

    doc.setLineDashPattern([2,2],0); doc.setDrawColor(138,122,90); doc.setLineWidth(0.3);
    doc.line(15,130,W-15,130); doc.setLineDashPattern([],0);
    doc.setFontSize(6); doc.setTextColor(138,122,90); doc.setFont('helvetica','normal');
    doc.text('Coupon a conserver', W/2, 134, {align:'center'});

    if (qrImg) { doc.addImage(qrImg,'PNG',W/2-22,137,44,44); }

    doc.setFontSize(6); doc.setTextColor(138,122,90);
    doc.text('Ref : ' + lastTransactionId, W/2, 185, {align:'center'});

    doc.setFillColor(26,20,8); doc.rect(0,H-16,W,16,'F');
    doc.setFontSize(7); doc.setTextColor(212,160,23); doc.setFont('helvetica','bold');
    doc.text('excellence-en-action.bj  -  +229 0163 350 339', W/2, H-8, {align:'center'});

    resolve(doc.output('datauristring'));
  });
}

function buildEmailHTML() {
  var featuresRows = '';
  for (var i = 0; i < pass.features.length; i++) {
    featuresRows += '<tr><td style="padding:6px 0;border-bottom:1px solid #2A1E08;">'
      + '<span style="color:#D4A017;margin-right:8px;">&#10003;</span>'
      + '<span style="color:#C8B89A;font-size:14px;">' + pass.features[i] + '</span>'
      + '</td></tr>';
  }
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#0D0A06;font-family:Arial,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0A06;">'
    + '<tr><td align="center" style="padding:40px 20px;">'
    + '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1A1408;border:1px solid #D4A017;">'

    + '<tr><td style="background:#1A0E00;padding:40px;text-align:center;border-bottom:3px solid #D4A017;">'
    + '<p style="color:#D4A017;font-size:11px;letter-spacing:4px;text-transform:uppercase;margin:0 0 8px;">Excellence en Action</p>'
    + '<h1 style="color:#fff;font-size:32px;margin:0;">CONFERENCE AU BENIN</h1>'
    + '<p style="color:#D4A017;font-size:20px;font-weight:bold;margin:4px 0 0;">2026</p>'
    + '</td></tr>'

    + '<tr><td style="padding:36px 40px 24px;text-align:center;">'
    + '<p style="font-size:36px;margin:0">&#127881;</p>'
    + '<h2 style="color:#fff;font-size:22px;margin:12px 0 8px;">Paiement confirme !</h2>'
    + '<p style="color:#8A7A5A;font-size:15px;line-height:1.6;margin:0;">Bonjour <strong style="color:#F0C040;">' + buyer.prenom + ' ' + buyer.nom + '</strong>,<br>'
    + 'ton inscription est officielle. Voici ton billet en piece jointe.</p>'
    + '</td></tr>'

    + '<tr><td style="padding:0 40px 32px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#241C0C;border:1px solid #D4A017;border-left:4px solid #D4A017;">'
    + '<tr>'
    + '<td style="padding:20px 24px;">'
    + '<p style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#8A7A5A;margin:0 0 4px;">Pass selectionne</p>'
    + '<p style="font-size:22px;font-weight:900;color:#fff;margin:0;">Pass ' + pass.name + '</p>'
    + '<p style="font-size:18px;color:#D4A017;font-weight:bold;margin:4px 0 0;">' + pass.price + ' FCFA</p>'
    + '</td>'
    + '<td style="padding:20px 24px;text-align:right;">'
    + '<p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8A7A5A;margin:0 0 4px;">Ref. transaction</p>'
    + '<p style="font-size:12px;color:#F0C040;font-weight:bold;margin:0;">' + lastTransactionId + '</p>'
    + '</td>'
    + '</tr></table></td></tr>'

    + '<tr><td style="padding:0 40px 32px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="50%" style="padding-right:8px;"><div style="background:#241C0C;padding:16px;">'
    + '<p style="font-size:10px;text-transform:uppercase;color:#8A7A5A;margin:0 0 4px;">Date</p>'
    + '<p style="font-size:15px;color:#fff;font-weight:bold;margin:0;">11 Juillet 2026</p></div></td>'
    + '<td width="50%" style="padding-left:8px;"><div style="background:#241C0C;padding:16px;">'
    + '<p style="font-size:10px;text-transform:uppercase;color:#8A7A5A;margin:0 0 4px;">Lieu</p>'
    + '<p style="font-size:15px;color:#fff;font-weight:bold;margin:0;">Benin Royal Hotel</p></div></td>'
    + '</tr><tr><td colspan="2" style="height:10px;"></td></tr>'
    + '<tr><td colspan="2"><div style="background:#241C0C;padding:16px;">'
    + '<p style="font-size:10px;text-transform:uppercase;color:#8A7A5A;margin:0 0 4px;">Mode de participation</p>'
    + '<p style="font-size:15px;color:#D4A017;font-weight:bold;margin:0;">' + buyer.mode + '</p>'
    + '</div></td></tr></table></td></tr>'

    + '<tr><td style="padding:0 40px 32px;">'
    + '<p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#8A7A5A;margin:0 0 12px;">Tes avantages inclus</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0">' + featuresRows + '</table>'
    + '</td></tr>'

    + '<tr><td style="padding:0 40px 32px;text-align:center;">'
    + '<div style="background:#0D3320;border:1px solid #009A44;padding:20px;">'
    + '<p style="color:#25D366;font-size:15px;font-weight:bold;margin:0 0 6px;">Ton billet PDF est en piece jointe</p>'
    + '<p style="color:#8A7A5A;font-size:13px;margin:0;">Presente ce billet a l\'entree ou scanne le QR code.</p>'
    + '</div></td></tr>'

    + '<tr><td style="padding:0 40px 40px;text-align:center;">'
    + '<a href="https://chat.whatsapp.com/Fe9VdseztjV05KcArUYF77" style="display:inline-block;background:#25D366;color:#000;font-weight:bold;font-size:14px;padding:16px 32px;text-decoration:none;">'
    + 'Rejoindre la communaute WhatsApp</a>'
    + '<p style="color:#8A7A5A;font-size:12px;margin:16px 0 0;">Questions : +229 0163 350 339</p>'
    + '</td></tr>'

    + '<tr><td style="background:#0D0A06;padding:20px;text-align:center;border-top:1px solid #2A1E08;">'
    + '<p style="color:#D4A017;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px;">Excellence en Action</p>'
    + '<p style="color:#8A7A5A;font-size:11px;margin:0;">2026 - Benin Royal Hotel - 11 Juillet 2026</p>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';
  return html;
}

function sendEmailViaResend(pdfData) {
  var pdfBase64 = pdfData.split(',')[1];
  var htmlBody = buildEmailHTML();
  var filename = 'Billet-ConfBenin2026-' + buyer.prenom + '-' + buyer.nom + '.pdf';
  var fromField = CONFIG.email_from_name + ' <' + CONFIG.email_from + '>';
  var subjectField = 'Ton billet confirme - Pass ' + pass.name + ' - Conference au Benin 2026';
  var toField = buyer.email;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.resend_api_key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromField,
      to: [toField],
      subject: subjectField,
      html: htmlBody,
      attachments: [{ filename: filename, content: pdfBase64 }]
    })
  }).then(function(response) {
    if (!response.ok) {
      return response.text().then(function(err){ throw new Error('Resend: ' + err); });
    }
    return response.json();
  });
}

function showLoading(){ document.getElementById('loading').classList.add('active'); }
function hideLoading(){ document.getElementById('loading').classList.remove('active'); }

function setStep(id, state) {
  var el = document.getElementById(id);
  var txt = el.textContent.replace(/^[\u23F3\u2705]\s*/,'');
  el.className = 'loading-step ' + state;
  if (state === 'done') el.textContent = '\u2705 ' + txt;
  else if (state === 'active-step') el.textContent = '\u23F3 ' + txt;
}

function showSuccess() {
  document.querySelector('.passes-section').style.display = 'none';
  var co = document.getElementById('checkout');
  co.classList.remove('active');
  co.style.display = 'none';
  document.getElementById('success-pass').textContent = pass.name + ' - ' + pass.price + ' FCFA';
  document.getElementById('success-email').textContent = buyer.email;
  document.getElementById('tx-ref').textContent = 'Reference : ' + lastTransactionId;
  var s = document.getElementById('success');
  s.classList.add('active');
  s.scrollIntoView({behavior:'smooth'});
}

function downloadPDF() {
  if (!pdfDataUrl) return;
  var a = document.createElement('a');
  a.href = pdfDataUrl;
  a.download = 'Billet-ConfBenin2026-' + buyer.prenom + '-' + buyer.nom + '.pdf';
  a.click();
}

function restart() {
  document.querySelector('.passes-section').style.display = 'block';
  var co = document.getElementById('checkout');
  co.style.display = '';
  co.classList.remove('active');
  document.getElementById('success').classList.remove('active');
  document.querySelectorAll('.pass-card').forEach(function(c){c.classList.remove('selected');});
  pdfDataUrl = '';
  window.scrollTo({top:0,behavior:'smooth'});
}
