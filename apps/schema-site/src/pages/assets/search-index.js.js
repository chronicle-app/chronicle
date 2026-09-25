// The data the search dialog in site.js reads: every page with its first
// sentence and the words it should match.
import {
  classes,
  examples,
  firstSentence,
  guides,
  paths,
  plain,
  properties,
  SECTIONS,
} from '../../lib/site.js';

const flat = text => plain(text).replaceAll(/\s+/g, ' ');
const entry = ({ path, kind, title, description = '', search = '' }) => ({
  title,
  kind,
  path,
  description: flat(firstSentence(description)),
  keywords: flat(`${description} ${search}`),
});
const section = kind => entry({ ...SECTIONS[kind], kind });

export function GET() {
  const index = [
    section('home'),
    section('guides'),
    ...guides.map(guide =>
      entry({
        path: paths.guide(guide.slug),
        kind: 'guide',
        title: guide.title,
        description: guide.lead,
        search: guide.text,
      })
    ),
    section('classes'),
    ...[...classes.values()].map(cls =>
      entry({
        path: paths.class(cls.name),
        kind: 'class',
        title: cls.name,
        description: cls.comment,
        search: [
          ...[cls.name, ...cls.ancestors].flatMap(name => classes.get(name).properties),
          ...cls.ancestors,
        ].join(' '),
      })
    ),
    section('properties'),
    ...[...properties.values()].map(property =>
      entry({
        path: paths.property(property.name),
        kind: 'property',
        title: property.name,
        description: property.comment,
        search: [...property.domain, ...property.range].join(' '),
      })
    ),
    section('examples'),
    ...examples.map(example =>
      entry({
        path: paths.example(example.id),
        kind: 'example',
        title: example.title,
        description: example.body,
        search: example.usedBy.join(' '),
      })
    ),
    section('validator'),
  ];
  return new Response(
    `window.SCHEMA_SEARCH = ${JSON.stringify(index).replaceAll('<', '\\u003c')};\n`,
    { headers: { 'content-type': 'text/javascript' } }
  );
}
