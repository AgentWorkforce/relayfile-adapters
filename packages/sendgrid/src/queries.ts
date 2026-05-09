export const SENDGRID_MAIL_SEND_ENDPOINT = '/v3/mail/send';
export const SENDGRID_CONTACTS_ENDPOINT = '/v3/marketing/contacts';
export const SENDGRID_MESSAGES_ENDPOINT = '/v3/messages';

export interface SendGridReadRequest {
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export function resolveSendGridReadRequest(path: string): SendGridReadRequest {
  if (path === '/sendgrid/contacts.json' || path === '/sendgrid/contacts/') {
    return {
      method: 'GET',
      endpoint: SENDGRID_CONTACTS_ENDPOINT,
    };
  }

  const contactMatch = path.match(/^\/sendgrid\/contacts\/([^/]+)\.json$/);
  if (contactMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: `${SENDGRID_CONTACTS_ENDPOINT}/${decodeURIComponent(contactMatch[1])}`,
    };
  }

  const eventMatch = path.match(/^\/sendgrid\/events\/([^/]+)\.json$/);
  if (eventMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: `${SENDGRID_MESSAGES_ENDPOINT}/${decodeURIComponent(eventMatch[1])}`,
    };
  }

  const mailMatch = path.match(/^\/sendgrid\/mail\/([^/]+)\.json$/);
  if (mailMatch?.[1]) {
    return {
      method: 'GET',
      endpoint: `${SENDGRID_MESSAGES_ENDPOINT}/${decodeURIComponent(mailMatch[1])}`,
    };
  }

  throw new Error(`No SendGrid read rule matched ${path}. Mail creation uses ${SENDGRID_MAIL_SEND_ENDPOINT}.`);
}
