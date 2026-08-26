import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT') ?? 587;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.logger.warn('SMTP not configured; emails will be logged instead of sent.');
    }
  }

  async sendPasswordReset(email: string, resetUrl: string) {
    const from = this.config.get<string>('SMTP_FROM') ?? 'noreply@trading-os.local';
    const appName = 'Trading OS';

    const message = {
      from,
      to: email,
      subject: `${appName} — Réinitialisation de votre mot de passe`,
      text: `Bonjour,\n\nVous avez demandé à réinitialiser votre mot de passe.\n\nCliquez sur ce lien (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
      html: `<p>Bonjour,</p><p>Vous avez demandé à réinitialiser votre mot de passe.</p><p><a href="${resetUrl}">Cliquez ici pour réinitialiser</a> (valable 1 heure)</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
    };

    if (this.transporter) {
      await this.transporter.sendMail(message);
      return { sent: true };
    }

    this.logger.warn({ to: email, resetUrl }, 'Password reset email not sent (SMTP disabled)');
    return { sent: false, reason: 'SMTP not configured' };
  }

  async sendVerificationEmail(email: string, verificationUrl: string) {
    const from = this.config.get<string>('SMTP_FROM') ?? 'noreply@trading-os.local';
    const appName = 'Trading OS';

    const message = {
      from,
      to: email,
      subject: `${appName} — Vérifiez votre adresse email`,
      text: `Bonjour,\n\nVeuillez vérifier votre adresse email en cliquant sur ce lien :\n${verificationUrl}`,
      html: `<p>Bonjour,</p><p><a href="${verificationUrl}">Cliquez ici pour vérifier votre email</a></p>`,
    };

    if (this.transporter) {
      await this.transporter.sendMail(message);
      return { sent: true };
    }

    this.logger.warn({ to: email, verificationUrl }, 'Verification email not sent (SMTP disabled)');
    return { sent: false, reason: 'SMTP not configured' };
  }
}
