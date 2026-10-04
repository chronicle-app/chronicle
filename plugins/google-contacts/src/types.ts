/** The parts of the People API's `Person` the plugin reads. */

export interface FieldMetadata {
  primary?: boolean;
  source?: { type?: string; id?: string };
}

export interface ContactPerson {
  /** `people/c123…`. */
  resourceName: string;
  metadata?: {
    sources?: { type?: string; id?: string; updateTime?: string }[];
    deleted?: boolean;
  };
  names?: { displayName?: string; metadata?: FieldMetadata }[];
  nicknames?: { value?: string }[];
  emailAddresses?: { value?: string; type?: string; metadata?: FieldMetadata }[];
  phoneNumbers?: {
    value?: string;
    /** E.164, when Google could tell the country. */
    canonicalForm?: string;
    type?: string;
  }[];
  organizations?: { name?: string; title?: string; current?: boolean }[];
  biographies?: { value?: string; contentType?: 'TEXT_PLAIN' | 'TEXT_HTML' }[];
  photos?: { url?: string; default?: boolean }[];
  urls?: { value?: string; type?: string }[];
  memberships?: { contactGroupMembership?: { contactGroupResourceName?: string } }[];
}

/** One extracted record: a contact, and the names of the labels it has. */
export interface ContactRecord {
  person: ContactPerson;
  labels: string[];
}
