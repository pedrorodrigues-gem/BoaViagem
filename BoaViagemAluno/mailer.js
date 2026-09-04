const nodemailer = require('nodemailer');
require('dotenv').config({ path: './config.env' });

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendPasswordResetEmail(to, resetUrl) {
    await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject: 'Boa Viagem — Recuperação de palavra-passe',
        html: `
            <p>Recebemos um pedido para repor a palavra-passe da sua conta Boa Viagem.</p>
            <p><a href="${resetUrl}">Clique aqui para definir uma nova palavra-passe</a></p>
            <p>Este link é válido por 30 minutos. Se não pediu esta recuperação, ignore este email.</p>
        `
    });
}

module.exports = { sendPasswordResetEmail };