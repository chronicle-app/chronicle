import { DataFactory, Parser, Store } from 'n3';
import fs from 'node:fs';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import prettierConfig from '@chronicle.app/prettier-config';

const { namedNode } = DataFactory;
const store = new Store();

// Optional paths support isolated generation checks without rewriting tracked output.
const ttlFilePath = process.argv[2] ?? fileURLToPath(new URL('../schema.ttl', import.meta.url));
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

const getDomain = (store, propertyId) =>
  store
    .getQuads(namedNode(propertyId), namedNode('https://schema.chronicle.app/domainIncludes'), null)
    .map(quad => quad.object.value);

const getRange = (store, propertyId) =>
  store
    .getQuads(namedNode(propertyId), namedNode('https://schema.chronicle.app/rangeIncludes'), null)
    .map(quad => quad.object.value);

const getSeeAlso = (store, id) => {
  const seeAlso = store.getQuads(
    namedNode(id),
    namedNode('http://www.w3.org/2000/01/rdf-schema#seeAlso'),
    null
  );

  return seeAlso[0]?.object?.value;
};

// owl:minCardinality 1
const isRequired = (store, propertyId) => {
  const minCardinality = store.getQuads(
    namedNode(propertyId),
    namedNode('http://www.w3.org/2002/07/owl#minCardinality'),
    null
  );

  if (minCardinality.length === 0) {
    return false;
  }

  return minCardinality[0]?.object?.value === '1';
};

const isMany = (store, propertyId) => {
  const maxCardinality = store.getQuads(
    namedNode(propertyId),
    namedNode('http://www.w3.org/2002/07/owl#maxCardinality'),
    null
  );

  if (maxCardinality.length === 0) {
    return true;
  }

  return maxCardinality[0]?.object?.value !== '1';
};

const getParents = (store, classId) => {
  const parents = store
    .getQuads(
      namedNode(classId),
      namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
      null
    )
    .map(quad => quad.object.value);

  return parents;
};

const extractSchemaInfo = store => {
  const classIds = store.getQuads(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/2000/01/rdf-schema#Class')
  );

  const classesRaw = classIds.map(classQuad => {
    const classId = classQuad.subject.value;

    return {
      classId,
      parents: getParents(store, classId),
      shortName: classId.split('/').pop(),
      children: findChildren(store, classId),
      comment: getComment(store, classId),
      seeAlso: getSeeAlso(store, classId),
    };
  });

  const classes = sortClassesTopologically(classesRaw);

  const propertyIds = store.getQuads(
    null,
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')
  );

  const properties = propertyIds
    .sort((a, b) => a.subject.value.localeCompare(b.subject.value))
    .map(propertyQuad => {
      const propertyId = propertyQuad.subject.value;

      return {
        propertyId,
        shortName: propertyId.split('/').pop(),
        comment: getComment(store, propertyId),
        seeAlso: getSeeAlso(store, propertyId),
        domain: getDomain(store, propertyId),
        range: getRange(store, propertyId),
        isRequired: isRequired(store, propertyId),
        isMany: isMany(store, propertyId),
      };
    })
    .filter(p => p.range.length > 0);

  const knownClasses = new Set(classes.map(c => c.classId));
  for (const property of properties) {
    for (const id of [...property.domain, ...property.range]) {
      if (!knownClasses.has(id))
        throw new Error(`Undeclared class ${id} on ${property.propertyId}`);
    }
  }

  return { classes, properties };
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

const writeSchemaFile = (classes, properties) =>
  new Promise((resolve, reject) => {
    const schemaFile = fs.createWriteStream(outputFilePath, {
      flags: 'w',
    });

    schemaFile.on('finish', () => resolve());
    schemaFile.on('error', reject);

    schemaFile.write(
      "// Generated from schema.ttl. Do not edit; run npm run schema:generate.\nimport { z } from 'zod';\n\n// Record identity key field: a property path, or a computed {key, value} entry\nexport type KeyField = string | { key: string; value: string };\n\n"
    );

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
    const classById = new Map(classes.map(c => [c.classId, c]));
    const BASE_CLASS_ID = 'https://schema.chronicle.app/Base';
    const descendsFromBase = (classId, seen = new Set()) => {
      if (classId === BASE_CLASS_ID) return true;
      if (seen.has(classId)) return false;
      seen.add(classId);
      const c = classById.get(classId);
      return Boolean(c) && (c.parents || []).some(p => descendsFromBase(p, seen));
    };

    for (const classInfo of classes.filter(classInfo => {
      const literalTypes = [
        'Boolean',
        'DataType',
        'Date',
        'DateTime',
        'Float',
        'Integer',
        'Number',
        'Text',
        'URL',
      ];
      return !literalTypes.includes(classInfo.shortName);
    })) {
      const { classId, shortName, children, parents } = classInfo;

      schemaFile.write(`\n\n// ${shortName}, child of ${classInfo.parents}\n`);

      const interfaceParents = parents.map(parent => {
        const parentShortName = parent.split('/').pop();
        return `Omit<${parentShortName}, "@type">`;
      });
      const proprtyStr = properties
        .filter(p => p.domain.includes(classId))
        .map(property => {
          const { shortName, range, isMany } = property;
          const { isRequired } = property;

          const rangeType = range.map(r => {
            const rangeShortName = r.split('/').pop();

            const typeMappings = {
              Text: 'string',
              Integer: 'bigint',
              DateTime: 'Date',
              Date: 'string',
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
${shortName === 'Base' ? '"@key"?: KeyField[];\n"@id"?: string;' : ''}
}
\n`;

      schemaFile.write(interfaceStr);

      const typeStr = `export type ${shortName}AndChildren = ${shortName} ${
        children.length > 0
          ? '| ' + children.map(child => child.split('/').pop() + 'AndChildren').join(' | ')
          : ''
      };\n\n`;

      schemaFile.write(typeStr);

      const attributes = properties
        .filter(p => p.domain.includes(classId))
        .map(property => {
          const { shortName, range, isMany, isRequired } = property;

          // A range that also admits a civil :Date (a verbatim string) must not
          // greedily coerce strings into instants — a date-only string like
          // "2026-06-03" would otherwise be anchored to UTC midnight. So the
          // :DateTime branch validates as a bare Date object here and lets every
          // string fall through to the :Date `z.string()`, preserving it. A
          // :DateTime-only property keeps coercion (no string fallback).
          const rangeAdmitsCivilDate = range.some(r => r.split('/').pop() === 'Date');

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
              return rangeAdmitsCivilDate ? 'z.date()' : 'z.coerce.date()';
            }
            if (rangeShortName === 'Date') {
              return 'z.string()';
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
${shortName === 'Base' ? ',"@key": z.array(z.union([z.string(), z.object({ key: z.string(), value: z.string() })])).optional(),\n"@id": z.string().optional(),' : ''}
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
    for (const classInfo of classes.reverse().filter(classInfo => {
      const literalTypes = [
        'Boolean',
        'DataType',
        'Date',
        'DateTime',
        'Float',
        'Integer',
        'Number',
        'Text',
        'URL',
      ];
      return !literalTypes.includes(classInfo.shortName);
    })) {
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

const objectSchemaForClassAndChildren = (classId, classes) => {
  const schemas = [];

  schemas.push(objectSchemaForClass(classId));

  const children = classes.filter(c => c.parents.includes(classId));

  for (const child of children) {
    schemas.push(objectSchemaForClassAndChildren(child.classId, classes));
  }

  return schemas.join(',\n');
};

const main = async () => {
  const ttlData = fs.readFileSync(ttlFilePath, 'utf8');

  const ttlParser = new Parser();
  const quadsArray = ttlParser.parse(ttlData);

  store.addQuads(quadsArray);

  const { classes, properties } = extractSchemaInfo(store);

  fs.mkdirSync(dirname(outputFilePath), { recursive: true });
  await writeSchemaFile(classes, properties);
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
