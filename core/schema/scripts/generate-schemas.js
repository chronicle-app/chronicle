import { DataFactory, Parser, Store } from 'n3';
import fs from 'node:fs';
import { schemaVersion } from './schema-version.js';
import {
  cardinalityOf,
  declaredClasses,
  declaredDatatypes,
  declaredProperties,
  domainOf,
  parentsOf,
  rangeOf,
} from './terms.js';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import prettierConfig from '@chronicle.app/prettier-config';

const { namedNode } = DataFactory;
const store = new Store();

// Optional paths support isolated generation checks without rewriting tracked output.
const ttlFilePath = process.argv[2] ?? fileURLToPath(new URL('../chronicle.ttl', import.meta.url));
const outputFilePath =
  process.argv[3] ?? fileURLToPath(new URL('../src/schema.ts', import.meta.url));

const findChildren = (store, classId) => {
  const children = store
    .getQuads(
      null,
      namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
      namedNode(classId)
    )
    .map(quad => quad.subject.value)
    .sort();

  return children;
};

const getComment = (store, classId) => {
  const comment = store.getQuads(
    namedNode(classId),
    namedNode('http://www.w3.org/2000/01/rdf-schema#comment'),
    null
  );

  return comment[0]?.object?.value;
};

const getSeeAlso = (store, id) => {
  const seeAlso = store.getQuads(
    namedNode(id),
    namedNode('http://www.w3.org/2000/01/rdf-schema#seeAlso'),
    null
  );

  return seeAlso[0]?.object?.value;
};

// :inverseName names a property's inverse. A record can give the relation
// under either name; the generator types the inverse on the forward range, and
// INVERSE_PROPERTIES tells a store which forward edge to keep.
const getInverseName = (store, propertyId) =>
  store.getQuads(
    namedNode(propertyId),
    namedNode('https://schema.chronicle.app/inverseName'),
    null
  )[0]?.object?.value;

// :metric says what form a number property's values take, a gauge or a sum,
// and :unit the one unit they are all in. METRIC_PROPERTIES gives both to a
// store, so it can keep and combine the values.
const METRIC_KINDS = ['gauge', 'sum'];
const annotationsOf = (store, propertyId, name) =>
  store
    .getQuads(namedNode(propertyId), namedNode(`https://schema.chronicle.app/${name}`), null)
    .map(quad => quad.object.value);
const getMetric = (store, propertyId, range) => {
  const [metrics, units] = ['metric', 'unit'].map(name => annotationsOf(store, propertyId, name));
  if (metrics.length === 0 && units.length === 0) return;
  if (metrics.length !== 1 || !METRIC_KINDS.includes(metrics[0])) {
    throw new Error(`${propertyId}: :metric must be one of ${METRIC_KINDS.join(', ')}`);
  }
  if (range.length !== 1 || range[0] !== 'https://schema.chronicle.app/Number') {
    throw new Error(`${propertyId}: a metric must take a :Number`);
  }
  if (units.length !== 1) throw new Error(`${propertyId}: a metric must have one :unit`);
  return { metric: metrics[0], unit: units[0] };
};

const extractSchemaInfo = store => {
  const classesRaw = declaredClasses(store).map(classTerm => {
    const classId = classTerm.value;

    return {
      classId,
      parents: parentsOf(store, classId),
      shortName: classId.split('/').pop(),
      children: findChildren(store, classId),
      comment: getComment(store, classId),
      seeAlso: getSeeAlso(store, classId),
    };
  });

  const classes = sortClassesTopologically(classesRaw);

  const properties = declaredProperties(store)
    .sort((a, b) => a.value.localeCompare(b.value))
    .map(propertyTerm => {
      const propertyId = propertyTerm.value;
      const { min, max } = cardinalityOf(store, propertyId);
      const range = rangeOf(store, propertyId);

      return {
        propertyId,
        shortName: propertyId.split('/').pop(),
        comment: getComment(store, propertyId),
        seeAlso: getSeeAlso(store, propertyId),
        domain: domainOf(store, propertyId),
        range,
        isRequired: min >= 1,
        isMany: max !== 1,
        inverseName: getInverseName(store, propertyId),
        metric: getMetric(store, propertyId, range),
      };
    })
    .filter(p => p.range.length > 0);

  // An inverse is authored on the forward property's range, takes many values,
  // and reaches back to the forward property's domain.
  const names = new Set(properties.map(p => p.shortName));
  const inverses = properties
    .filter(p => p.inverseName)
    .map(p => {
      if (names.has(p.inverseName)) {
        throw new Error(`${p.propertyId}: inverse name ${p.inverseName} is already a property`);
      }
      return {
        propertyId: null,
        shortName: p.inverseName,
        inverseOf: p.shortName,
        domain: p.range,
        range: p.domain,
        isRequired: false,
        isMany: true,
      };
    });

  const knownTerms = new Set([
    ...classes.map(c => c.classId),
    ...declaredDatatypes(store).map(datatype => datatype.value),
  ]);
  for (const property of properties) {
    for (const id of [...property.domain, ...property.range]) {
      if (!knownTerms.has(id)) throw new Error(`Undeclared class ${id} on ${property.propertyId}`);
    }
  }

  return { classes, properties, inverses };
};

const sortClassesTopologically = classes => {
  const byId = new Map(classes.map(c => [c.classId, c]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cyclic class inheritance: ${id}`);
    const item = byId.get(id);
    if (!item) throw new Error(`Undeclared parent class: ${id}`);
    visiting.add(id);
    for (const parent of [...item.parents].sort()) visit(parent);
    visiting.delete(id);
    visited.add(id);
    sorted.push(item);
  };
  for (const id of [...byId.keys()].sort()) visit(id);
  return sorted;
};

const writeSchemaFile = (classes, properties, inverses, version) =>
  new Promise((resolve, reject) => {
    const schemaFile = fs.createWriteStream(outputFilePath, {
      flags: 'w',
    });

    schemaFile.on('finish', () => resolve());
    schemaFile.on('error', reject);
    schemaFile.write(`export const SCHEMA_VERSION = ${JSON.stringify(version)} as const;\n`);

    schemaFile.write(
      "// Generated from chronicle.ttl. Do not edit; run npm run schema:generate.\nimport { z } from 'zod';\nimport { isDateTime, isInstant } from './datetime.js';\n\n// Record identity key field: a property path, or a computed {key, value} entry\nexport type KeyField = string | { key: string; value: string };\n\n"
    );

    // A Date is an instant; a string is kept verbatim, never coerced, so a
    // date like "2026-06-03" stays a day rather than becoming UTC midnight.
    schemaFile.write(
      'const DateTimeSchema = z.union([\n' +
        '  z.date(),\n' +
        "  z.string().refine(isDateTime, 'Not a date or time. Use EDTF, such as 2026-03-14T09:26:00Z, 2026-03-14, or 1987.'),\n" +
        ']);\n\n'
    );

    // The forward edge a store keeps for each inverse name a record can use.
    schemaFile.write('/** Inverse property name → the forward property it reverses. */\n');
    schemaFile.write('export const INVERSE_PROPERTIES: Record<string, string> = {\n');
    for (const inverse of inverses) {
      schemaFile.write(
        `  ${JSON.stringify(inverse.shortName)}: ${JSON.stringify(inverse.inverseOf)},\n`
      );
    }
    schemaFile.write('};\n\n');

    // The form each metric's values take, and the unit they are in.
    schemaFile.write(
      '/** Metric property name → the form its values take and the unit they are in. */\n'
    );
    schemaFile.write(
      "export const METRIC_PROPERTIES: Record<string, { metric: 'gauge' | 'sum'; unit: string }> = {\n"
    );
    for (const property of properties.filter(p => p.metric)) {
      schemaFile.write(
        `  ${JSON.stringify(property.shortName)}: ${JSON.stringify(property.metric)},\n`
      );
    }
    schemaFile.write('};\n\n');

    // Identity comes from the source, expressed as @key or @id, including nested nodes.
    schemaFile.write(
      'function requireNodeIdentity(\n' +
        "  node: { '@key'?: unknown; '@id'?: unknown },\n" +
        '  ctx: z.RefinementCtx\n' +
        '): void {\n' +
        "  const hasKey = Array.isArray(node['@key']) && node['@key'].length > 0;\n" +
        "  const hasId = typeof node['@id'] === 'string' && node['@id'].length > 0;\n" +
        '  if (!hasKey && !hasId) {\n' +
        '    ctx.addIssue({\n' +
        '      code: z.ZodIssueCode.custom,\n' +
        "      message: 'Node must carry @key or @id — every identity-bearing node needs an identity.',\n" +
        '    });\n' +
        '  }\n' +
        '}\n\n'
    );

    // A class carries the `@key`/`@id` identity refinement iff it descends from
    // Base — every entity and action node. Value nodes descend from
    // StructuredValue instead and are content-interned, so they stay exempt.
    // Inverses are typed beside the declared properties on the classes they apply to.
    const authored = [...properties, ...inverses];
    const classById = new Map(classes.map(c => [c.classId, c]));
    const BASE_CLASS_ID = 'https://schema.chronicle.app/Base';
    const descendsFromBase = (classId, seen = new Set()) => {
      if (classId === BASE_CLASS_ID) return true;
      if (seen.has(classId)) return false;
      seen.add(classId);
      const c = classById.get(classId);
      return Boolean(c) && (c.parents || []).some(p => descendsFromBase(p, seen));
    };

    for (const classInfo of classes) {
      const { classId, shortName, children, parents } = classInfo;

      schemaFile.write(`\n\n// ${shortName}, child of ${classInfo.parents}\n`);

      const interfaceParents = parents.map(parent => {
        const parentShortName = parent.split('/').pop();
        return `Omit<${parentShortName}, "@type">`;
      });
      const proprtyStr = authored
        .filter(p => p.domain.includes(classId))
        .map(property => {
          const { shortName, range, isMany } = property;
          const { isRequired } = property;

          const rangeType = range.map(r => {
            const rangeShortName = r.split('/').pop();

            const typeMappings = {
              Text: 'string',
              Integer: 'bigint',
              DateTime: 'Date | string',
              Float: 'number',
              Number: 'number',
              Boolean: 'boolean',
              URL: 'string',
            };

            return typeMappings[rangeShortName] || `${rangeShortName}AndChildren`;
          });

          if (rangeType.length > 0) {
            return `${shortName}${isRequired ? '' : '?'}: (${rangeType.join(' | ')})${isMany ? '[]' : ''};`;
          }
          return '';
        });
      const interfaceStr = `export interface ${shortName} ${
        interfaceParents.length > 0 ? 'extends' : ''
      } ${interfaceParents.join(',')} {
"@type": "${shortName}";
${proprtyStr.join('\n')}
${shortName === 'Base' ? '"@key"?: KeyField[];\n"@id"?: string;\n"@asserts"?: string[];\n"@assertedAt"?: Date | string;' : ''}
}
\n`;

      schemaFile.write(interfaceStr);

      const typeStr = `export type ${shortName}AndChildren = ${shortName} ${
        children.length > 0
          ? '| ' + children.map(child => child.split('/').pop() + 'AndChildren').join(' | ')
          : ''
      };\n\n`;

      schemaFile.write(typeStr);

      const attributes = authored
        .filter(p => p.domain.includes(classId))
        .map(property => {
          const { shortName, range, isMany, isRequired } = property;

          const zodTypes = range.map(r => {
            const rangeShortName = r.split('/').pop();

            if (rangeShortName === 'Text') {
              return 'z.string()';
            }
            if (rangeShortName === 'URL') {
              return 'z.string().url()';
            }
            if (rangeShortName === 'Boolean') {
              return 'z.boolean()';
            }
            if (rangeShortName === 'Integer') {
              return 'z.bigint()';
            }
            if (rangeShortName === 'Float') {
              return 'z.number()';
            }
            if (rangeShortName === 'Number') {
              return 'z.number()';
            }
            if (rangeShortName === 'DateTime') {
              return 'DateTimeSchema';
            }
            return `${rangeShortName}AndChildrenSchema`;
          });

          if (zodTypes.length === 0) {
            return null;
          }

          const typeString =
            zodTypes.length === 1 ? zodTypes[0] : `z.union([${zodTypes.join(', ')}])`;
          const cardinalityWrapper = isMany ? `z.array(${typeString})` : typeString;

          return `${shortName}: z.lazy(() => ${cardinalityWrapper})${isRequired ? '' : '.optional()'}`;
        });
      const propertiesStr = `const ${shortName}Properties = {
  ${parents
    .map(parent => {
      const parentShortName = parent.split('/').pop();
      return `...${parentShortName}Properties,`;
    })
    .join('\n')}
${attributes.filter(Boolean).join(',\n')}
${shortName === 'Base' ? ',"@key": z.array(z.union([z.string(), z.object({ key: z.string(), value: z.string() })])).optional(),\n"@id": z.string().optional(),\n"@asserts": z.array(z.string()).optional(),\n"@assertedAt": z.union([z.date(), z.string().refine(isInstant, "Not an instant. Use a UTC time, such as 2026-03-14T09:26:00Z.")]).optional(),' : ''}
};
\n\n`;

      schemaFile.write(propertiesStr);

      const schemaStr = `export const ${shortName}Schema: z.ZodType<${shortName}> = z
  .object({
    "@type": z.literal("${shortName}"),
    ...${shortName}Properties,
  })
  ${descendsFromBase(classId) ? '.superRefine(requireNodeIdentity)' : ''};\n\n`;

      schemaFile.write(schemaStr);
    }

    // put the discriminated union at the end so that all the classes are defined
    // reverse so that the parent classes are defined before the child
    for (const classInfo of classes.reverse()) {
      const { classId, shortName } = classInfo;

      let discriminatedUnionStr;

      // The identity refinement rides the AndChildren schema — the form every
      // nested entity-ranged property and the root validator — so it runs
      // on each node exactly once, recursively, as the tree is validated.
      const refine = descendsFromBase(classId) ? '.superRefine(requireNodeIdentity)' : '';

      if (classInfo.children.length === 0) {
        discriminatedUnionStr = `export const ${shortName}AndChildrenSchema = ${shortName}Schema;\n\n`;
      } else {
        const childrenSchemas = objectSchemaForClassAndChildren(classId, classes);

        discriminatedUnionStr = `export const ${shortName}AndChildrenSchema: z.ZodType<${shortName}AndChildren> = z.discriminatedUnion("@type", [
           ${childrenSchemas}])${refine};
        `;
      }

      schemaFile.write(discriminatedUnionStr);
    }

    // Close the stream
    schemaFile.end();
  });

const objectSchemaForClass = classId => {
  const shortName = classId.split('/').pop();
  return `
  z.object({
    "@type": z.literal("${shortName}"),
    ...${shortName}Properties,
  })
  `;
};

// A class with two parents is reachable twice. List each class once, since a
// discriminated union rejects a repeated @type.
const objectSchemaForClassAndChildren = (classId, classes) => {
  const classIds = [];
  const visit = id => {
    if (classIds.includes(id)) return;
    classIds.push(id);
    for (const child of classes.filter(c => c.parents.includes(id))) visit(child.classId);
  };
  visit(classId);

  return classIds.map(id => objectSchemaForClass(id)).join(',\n');
};

const main = async () => {
  const ttlData = fs.readFileSync(ttlFilePath, 'utf8');

  const ttlParser = new Parser();
  const quadsArray = ttlParser.parse(ttlData);

  store.addQuads(quadsArray);

  const { classes, properties, inverses } = extractSchemaInfo(store);

  fs.mkdirSync(dirname(outputFilePath), { recursive: true });
  await writeSchemaFile(classes, properties, inverses, schemaVersion(ttlData));
  const formatted = await prettier.format(fs.readFileSync(outputFilePath, 'utf8'), {
    ...prettierConfig,
    parser: 'typescript',
  });
  fs.writeFileSync(outputFilePath, formatted);

  console.log('Schema file generated successfully!');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
