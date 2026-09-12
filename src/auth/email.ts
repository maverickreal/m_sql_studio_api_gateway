import nodemailer from "nodemailer";
import { envVars, logger } from "../config";

export interface SendVerificationEmailParams {
  user: {
    email: string;
    name?: string | null;
  };
  url: string;
  token: string;
}

export async function sendVerificationEmail({
  user,
  url,
}: SendVerificationEmailParams): Promise<void> {
  if (
    !envVars.SMTP_HOST ||
    !envVars.SMTP_PORT ||
    !envVars.SMTP_USER ||
    !envVars.SMTP_PASS ||
    !envVars.SMTP_FROM
  ) {
    logger.warn(
      "SMTP configuration incomplete; skipping verification email sending",
    );
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: envVars.SMTP_HOST,
      port: envVars.SMTP_PORT,
      secure: envVars.SMTP_PORT === 465,
      auth: {
        user: envVars.SMTP_USER,
        pass: envVars.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: envVars.SMTP_FROM,
      to: user.email,
      subject: "Verify your email address",
      text: `Please verify your email address by visiting: ${url}`,
      html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${url}">${url}</a></p>`,
    });
  } catch (err) {
    logger.error(
      { message: err instanceof Error ? err.message : String(err) },
      "Failed to send verification email",
    );
  }
}
