import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every file's mtime, so the export's compile time (the snapshot as-of) is fixed. */
export const COMPILED_AT = new Date('2026-08-08T08:29:38.000Z');

const FILES = {
  'Profile.csv': `First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers
Ada,Lovelace,,,,Building an analytical engine,,Software Development,,"London, England, United Kingdom",[ada],[PERSONAL:http://ada.example],
`,
  'Email Addresses.csv': `Email Address,Confirmed,Primary,Updated On
old@example.com,Yes,No,"10/24/13, 8:43 AM"
ada@example.com,Yes,Yes,Not Available
`,
  'Invitations.csv': `From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl
Ada Lovelace,Charles Babbage,"6/6/26, 2:54 PM",,OUTGOING,https://www.linkedin.com/in/ada,https://www.linkedin.com/in/babbage
`,
  'Connections.csv': `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Charles,Babbage,https://www.linkedin.com/in/babbage,babbage@example.com,Analytical Engines Ltd,Founder,06 Jun 2026
Grace,Hopper,https://www.linkedin.com/in/hopper?utm_source=share,,US Navy,Rear Admiral,02 Jan 2019
,,,,,,03 Mar 2020
`,
  'Company Follows.csv': `Organization,Followed On
Analytical Engines Ltd,Fri Jan 24 02:54:41 UTC 2025
`,
  'Positions.csv': `Company Name,Title,Description,Location,Started On,Finished On
Analytical Engines Ltd,Chief Programmer,Wrote the first algorithm,"London, England",Aug 2022,
Difference Engine Co,Advisor,,,2009,2011
`,
  'Education.csv': `School Name,Start Date,End Date,Notes,Degree Name,Activities
University of London,2003,2009,Thesis on looms,Bachelor of Science (B.S.),Chess club
`,
  'Endorsement_Given_Info.csv': `Endorsement Date,Skill Name,Endorsee First Name,Endorsee Last Name,Endorsee Public Url,Endorsement Status
2017/05/07 01:01:57 UTC,Mechanical Computation,Charles,Babbage,www.linkedin.com/in/babbage,ACCEPTED
`,
  'Endorsement_Received_Info.csv': `Endorsement Date,Skill Name,Endorser First Name,Endorser Last Name,Endorser Public Url,Endorsement Status
2018/10/18 12:23:20 UTC,Algorithms,Grace,Hopper,www.linkedin.com/in/hopper,ACCEPTED
`,
  'Learning.csv': `Content Title,Content Description,Content Type,Content Last Watched Date (if viewed),Content Completed At (if completed),Content Saved,Notes taken on videos (if taken),
Looms for Programmers,A course about looms,Course,2020-12-29 14:24 UTC,2021-01-04 09:00 UTC,true,N/A,
Unwatched Course,,Course,N/A,N/A,false,N/A,
`,
  'messages.csv': `"CONVERSATION ID","CONVERSATION TITLE","FROM","SENDER PROFILE URL","TO","RECIPIENT PROFILE URLS","DATE","SUBJECT","CONTENT","FOLDER","ATTACHMENTS"
"2-conv-one","","Charles Babbage","https://www.linkedin.com/in/babbage","Ada Lovelace","https://www.linkedin.com/in/ada","2026-03-13 03:18:54 UTC","","Shall we compute?","INBOX",""
"2-conv-one","","Ada Lovelace","https://www.linkedin.com/in/ada","Charles Babbage","https://www.linkedin.com/in/babbage","2026-03-13 04:00:00 UTC","","Yes.","INBOX",""
"2-conv-two","Engine crew","LinkedIn Member","","Grace Hopper,LinkedIn Member,Ada Lovelace","https://www.linkedin.com/in/hopper,https://www.linkedin.com/in/ada","2025-01-02 10:00:00 UTC","A subject","Group note","ARCHIVE","https://www.linkedin.com/dms/prv/vid/v2/AAA?e=1&t=x"
"2-conv-three","Sponsored Conversation","Ada Recruiter","","Ada Lovelace","https://www.linkedin.com/in/ada","2024-05-01 08:00:00 UTC","","<p class=""spinmail-quill-editor__spin-break"">Hi&nbsp;there!</p><p class=""spinmail-quill-editor__spin-break""><br></p><p>Read <a href=""https://example.com/jobs"">more</a>.</p>","INBOX",""
`,
};

/**
 * A synthetic, unpacked LinkedIn export: every CSV the plugin reads, with the
 * fictional member Ada. Returns the directory.
 */
export function writeLinkedInExport(dir) {
  for (const [name, text] of Object.entries(FILES)) {
    const file = join(dir, name);
    writeFileSync(file, text);
    utimesSync(file, COMPILED_AT, COMPILED_AT);
  }
  return dir;
}
