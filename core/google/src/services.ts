/**
 * The Google services Chronicle sources read, by the name a person passes to
 * `chronicle auth login google --add`: the read-only scope each needs and
 * the API that has to be on in the person's Google Cloud project.
 */
export const GOOGLE_SERVICES = {
  gmail: {
    label: 'Gmail',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    api: 'gmail.googleapis.com',
  },
  calendar: {
    label: 'Google Calendar',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    api: 'calendar-json.googleapis.com',
  },
  drive: {
    label: 'Google Drive',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    api: 'drive.googleapis.com',
  },
} as const;

export type GoogleService = keyof typeof GOOGLE_SERVICES;

export const isGoogleService = (name: string): name is GoogleService =>
  Object.hasOwn(GOOGLE_SERVICES, name);
