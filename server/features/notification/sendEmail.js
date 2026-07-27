import logger from '~~/server/utils/logger';
import { connectDB } from '~~/server/db/mongo';

async function sendEmail(to, subject, htmlBody) {
  try {
    const response = await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useRuntimeConfig().resendToken}`,
      },
      body: {
        from: useRuntimeConfig().resendFrom || 'onboarding@resend.dev',
        to: to,
        subject: subject,
        html: htmlBody,
      },
    });
    logger.info('Email sent successfully!');
    logger.info('Response:', response);
  } catch (error) {
    logger.error('Failed to send email:', error);
    throw error;
  }
}

export async function sendNestFinishEmail(nestingJob) {
  const db = await connectDB();
  const project = await db.collection('projects').findOne({ slug: nestingJob.projectSlug });
  const user = await db.collection('users').findOne({ id: nestingJob.ownerId });
  if (!user || !project) {
    logger.error('User or project not found');
    throw createError({
      statusCode: 404,
      statusMessage: "User or project not found",
    });
  }
  try {
    const recipient = user.email;
    const emailSubject = `Your nesting project ${project.name} is finished`;
    const emailBody = `
      <p>Your nesting project ${project.name} is finished</p>
      <p>You can view the project <a href="${useRuntimeConfig().public.baseUrl}/project/${project.slug}">here</a></p>
    `;

    await sendEmail(recipient, emailSubject, emailBody);
    logger.info('Email sending process completed.');
  } catch (err) {
    logger.error('Failed to send email:', err);
  }
}

export async function sendNewSupportMessageEmail(userId) {
  const db = await connectDB();
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) {
    logger.error('User not found');
    throw createError({
      statusCode: 404,
      statusMessage: "User not found",
    });
  }

  try {
    const recipient = user.email;
    const emailSubject = `New support message from APlasma Nesting`;
    const emailBody = `
      <p>Hello,</p>
      <p>You have received a new message from the APlasma Nesting support team.</p>
      <p>Please log in to your account to view the message.</p>
      <p><a href="${useRuntimeConfig().public.baseUrl}">View Message</a></p>
      <p>Best regards, <br> APlasma Nesting</p>
      <p>For unsubscribe, just reply to this email with word "unsubscribe", or notify us through our support chat.</p>
    `;

    await sendEmail(recipient, emailSubject, emailBody);
    logger.info(`Support notification email sent to ${recipient}`);
  } catch (err) {
    logger.error('Failed to send support notification email:', err);
  }
}

export async function sendPasswordResetEmail(email, resetUrl) {
  const emailSubject = 'Reset your APlasma Nesting password';
  const emailBody = `
    <p>Hello,</p>
    <p>We received a request to reset the password of your APlasma Nesting account.</p>
    <p><a href="${resetUrl}">Click here to choose a new password</a></p>
    <p>This link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    <p>Best regards, <br> APlasma Nesting</p>
  `;

  await sendEmail(email, emailSubject, emailBody);
  logger.info(`Password reset email sent to ${email}`);
}
