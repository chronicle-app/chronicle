/**
 * AddressBook integration for macOS
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizePhoneNumber } from '@chronicle.app/etl';

export interface Contact {
  /** Stable, portable contact id (AddressBook ZEXTERNALUUID — the CardDAV/iCloud id). */
  id?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  fullName?: string;
  emails: string[];
  phoneNumbers: string[];
}

/**
 * Cached AddressBook contact lookup
 */
export class ContactCache {
  constructor(private readonly databasePaths?: string[]) {}

  private emailIndex = new Map<string, Contact>();
  private phoneIndex = new Map<string, Contact>();
  private nameIndex = new Map<string, Contact[]>();
  private initialized = false;

  private getAddressBookPaths(): string[] {
    if (this.databasePaths) return this.databasePaths;
    const root = path.join(homedir(), 'Library/Application Support/AddressBook');
    const result: string[] = [];
    const local = path.join(root, 'AddressBook-v22.abcddb');
    if (fs.existsSync(local)) result.push(local);
    const sources = path.join(root, 'Sources');
    if (fs.existsSync(sources)) {
      for (const source of fs.readdirSync(sources).sort()) {
        const file = path.join(sources, source, 'AddressBook-v22.abcddb');
        if (fs.existsSync(file)) result.push(file);
      }
    }
    return result;
  }

  private initialize(): void {
    if (this.initialized) return;

    let paths: string[];
    try {
      paths = this.getAddressBookPaths();
    } catch {
      paths = [];
    }
    for (const dbPath of paths) {
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(dbPath, { readOnly: true });

        // Load all contacts with emails
        const emailQuery = `
        SELECT 
          r.Z_PK,
          r.ZFIRSTNAME,
          r.ZLASTNAME,
          r.ZORGANIZATION,

          r.ZEXTERNALUUID AS externalUuid,
          e.ZADDRESS as email
        FROM ZABCDRECORD r
        JOIN ZABCDEMAILADDRESS e ON r.Z_PK = e.ZOWNER
      `;

        const emailRows = db.prepare(emailQuery).all() as any[];

        // Load all contacts with phone numbers
        const phoneQuery = `
        SELECT 
          r.Z_PK,
          r.ZFIRSTNAME,
          r.ZLASTNAME,
          r.ZORGANIZATION,

          r.ZEXTERNALUUID AS externalUuid,
          p.ZFULLNUMBER as phone
        FROM ZABCDRECORD r
        JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
      `;

        const phoneRows = db.prepare(phoneQuery).all() as any[];

        // Build contact objects and indexes
        const contactMap = new Map<number, Contact>();

        // Process email contacts
        for (const row of emailRows) {
          let contact = contactMap.get(row.Z_PK);
          if (!contact) {
            const fullName =
              [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(' ') ||
              row.ZORGANIZATION ||
              undefined;

            contact = {
              id: row.externalUuid || undefined,
              firstName: row.ZFIRSTNAME || undefined,
              lastName: row.ZLASTNAME || undefined,
              organization: row.ZORGANIZATION || undefined,
              fullName,
              emails: [],
              phoneNumbers: [],
            };
            contactMap.set(row.Z_PK, contact);
          }

          contact.emails.push(row.email);
          // Index by lowercase email for case-insensitive lookup
          this.emailIndex.set(row.email.toLowerCase(), contact);
        }

        // Process phone contacts
        for (const row of phoneRows) {
          let contact = contactMap.get(row.Z_PK);
          if (!contact) {
            const fullName =
              [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(' ') ||
              row.ZORGANIZATION ||
              undefined;

            contact = {
              id: row.externalUuid || undefined,
              firstName: row.ZFIRSTNAME || undefined,
              lastName: row.ZLASTNAME || undefined,
              organization: row.ZORGANIZATION || undefined,
              fullName,
              emails: [],
              phoneNumbers: [],
            };
            contactMap.set(row.Z_PK, contact);
          }

          contact.phoneNumbers.push(row.phone);
          // Index by normalized phone number
          const normalized = normalizePhoneNumber(row.phone);
          if (normalized) {
            this.phoneIndex.set(normalized, contact);
          }
        }

        // Index by normalized full name (all candidates) — for backfill recovery
        // from name-only sources (e.g. the Timing call relay). A shared name is
        // resolved only when it narrows to one (see lookupByName).
        for (const contact of contactMap.values()) {
          if (!contact.fullName) continue;
          const key = normalizeName(contact.fullName);
          if (!key) continue;
          const list = this.nameIndex.get(key) ?? [];
          list.push(contact);
          this.nameIndex.set(key, list);
        }

        // Optional: log cache initialization stats
        // console.log(
        //   `Loaded ${contactMap.size} contacts (${this.emailIndex.size} emails, ${this.phoneIndex.size} phones)`
        // );
      } catch (error) {
        console.warn('Error loading AddressBook cache:', error);
      } finally {
        db?.close();
      }
    }
    this.initialized = true;
  }

  lookupByEmail(email: string): Contact | null {
    this.initialize();
    return this.emailIndex.get(email.toLowerCase()) || null;
  }

  lookupByPhone(phoneNumber: string): Contact | null {
    this.initialize();
    const normalized = normalizePhoneNumber(phoneNumber);
    return normalized ? this.phoneIndex.get(normalized) || null : null;
  }

  /**
   * Look up a contact by display name — for backfill from name-only sources
   * (e.g. the Timing call relay). Returns null when the name is unknown, or maps
   * to more than one contact and can't be narrowed. With `preferPhone` (the call
   * case), a tie is broken by the sole phone-bearing card — a phone call's party
   * must have a number, so an email-only namesake is not it.
   */
  lookupByName(name: string, opts: { preferPhone?: boolean } = {}): Contact | null {
    this.initialize();
    const key = normalizeName(name);
    if (!key) return null;
    const candidates = this.nameIndex.get(key) ?? [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1 && opts.preferPhone) {
      const withPhone = candidates.filter(c => c.phoneNumbers.length > 0);
      if (withPhone.length === 1) return withPhone[0];
    }
    return null;
  }

  lookupByHandle(handle: string): Contact | null {
    if (!handle) return null;
    if (handle.includes('@')) {
      return this.lookupByEmail(handle);
    }
    return this.lookupByPhone(handle);
  }

  getAllContactsWithEmails(): Contact[] {
    this.initialize();
    const seen = new Set<Contact>();
    for (const contact of this.emailIndex.values()) {
      seen.add(contact);
    }
    return [...seen];
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

// Global cache instance
const contactCache = new ContactCache();

/**
 * Look up a contact by email address
 */
export function lookupContactByEmail(email: string): Contact | null {
  return contactCache.lookupByEmail(email);
}

/**
 * Look up a contact by phone number
 */
export function lookupContactByPhone(phoneNumber: string): Contact | null {
  return contactCache.lookupByPhone(phoneNumber);
}

/**
 * Look up a contact by email or phone number
 */
export function lookupContact(handle: string): Contact | null {
  return contactCache.lookupByHandle(handle);
}

/**
 * Look up a contact by display name — for backfilling handles onto name-only
 * records (e.g. the Timing call relay). Returns null for unknown or ambiguous
 * (multi-contact) names.
 */
export function lookupContactByName(
  name: string,
  opts: { preferPhone?: boolean } = {}
): Contact | null {
  return contactCache.lookupByName(name, opts);
}

/**
 * Get all contacts with email addresses
 */
export function getAllContactsWithEmails(): Contact[] {
  return contactCache.getAllContactsWithEmails();
}
