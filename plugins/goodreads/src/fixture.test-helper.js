// A synthetic Goodreads library export: the export's real header row and three
// made-up books. ISBNs are wrapped as ="…", the way Goodreads writes them.
const HEADER = [
  'Book Id',
  'Title',
  'Author',
  'Author l-f',
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Bookshelves with positions',
  'Exclusive Shelf',
  'My Review',
  'Spoiler',
  'Private Notes',
  'Read Count',
  'Owned Copies',
].join(',');

const ROWS = [
  // Read, with a co-author (and the primary author repeated), two custom shelves,
  // a review, an ISBN-13, and a page count.
  '40961427,The Lighthouse Keeper,Maya Lindqvist,"Lindqvist, Maya","Tomas Berg, Maya Lindqvist","=""0000000019""","=""9780000000019""",4,4.10,Harbor Press,Paperback,312,2019,2018,2025/03/14,2025/01/20,"favorites, sea stories, read","favorites (#1), sea stories (#2), read (#3)",read,Quiet and patient.,,,1,0',
  // To read: no ISBN, pages, review, or custom shelf.
  '51234,Field Notes on Tides,Ines Okafor,"Okafor, Ines",,"=""""","=""""",0,3.90,Tidewater Books,Hardcover,,2021,2021,,2025/06/02,to-read,to-read (#4),to-read,,,,0,0',
  // Currently reading, with no publisher.
  '77001,A Winter Garden,Lee Park,"Park, Lee",,"=""""","=""""",0,4.00,,Kindle Edition,,2022,2022,,2025/08/11,currently-reading,currently-reading (#1),currently-reading,,,,0,0',
];

export const LIBRARY_CSV = `${HEADER}\n${ROWS.join('\n')}\n`;
