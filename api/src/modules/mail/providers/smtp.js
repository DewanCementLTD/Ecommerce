import nodemailer from 'nodemailer';
import { env } from '../../../config/env.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.smtp.host,
      port: env.mail.smtp.port,
      secure: env.mail.smtp.secure,
      auth: env.mail.smtp.user ? { user: env.mail.smtp.user, pass: env.mail.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export const smtpProvider = {
  async send({ to, subject, html, text }) {
    await getTransporter().sendMail({ from: env.mail.smtp.from, to, subject, html, text });
  },
};
