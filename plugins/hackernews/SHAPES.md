# Hacker News shapes

Generated from what the transformer makes of the test fixtures. Do not edit:
run `npm run shapes` in this plugin to update it.

For each record type: the paths in its input, the nodes in its output, and
where each output value came from. `[]` is any list element. A value is
copied from an input path; converted (`String`, `lower`, `date`, `unix`);
built around one (`…{path}…`, as a URL around an id); from a different
path each time (`varies`); always the same (`= value`, `seen once` when
the fixtures show it once); or `computed` in the transformer.

## Graph

- Comment —about→ Post
- Comment —author→ Agent
- Post —author→ Agent
- Post —references→ Entity
- PublishAction —agent→ Agent
- PublishAction —object→ Post
- RespondAction —agent→ Agent
- RespondAction —object→ Comment
- RespondAction —object→ Post
- RespondAction —result→ Comment

## submissions

### Input

| Path | Value | Present |
| --- | --- | --- |
| `id` | number | always |
| `time` | number | always |
| `type` | text | always |
| `by` | text | always |
| `title` | text | always |
| `parts` | empty list | sometimes |
| `text` | text | sometimes |
| `url` | text | sometimes |
| `kids[]` | number | sometimes |

### Output

#### `PublishAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `timestamp` | date | always | unix(time) |
| `agent` | → Agent | always |  |
| `object` | → Post | always |  |

#### `agent` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | …{by}… |
| `description` | text | always | = "Bread and bikes." |

#### `object` → `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `url` | text | always | …{id}… |
| `name` | text | always | title |
| `author` | list of → Agent | always |  |
| `body` | text | sometimes | = "Weekends only.\nSee my starter (https://example.com/starter)." (seen once) |
| `references` | list of → Entity | sometimes |  |

#### `object.author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | …{by}… |
| `description` | text | always | = "Bread and bikes." |

#### `object.references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | url |

## comments

### Input

| Path | Value | Present |
| --- | --- | --- |
| `id` | number | always |
| `time` | number | always |
| `type` | text | always |
| `by` | text | always |
| `parent` | number | always |
| `text` | text | always |
| `kids[]` | number | sometimes |

### Output

#### `RespondAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `timestamp` | date | always | unix(time) |
| `agent` | → Agent | always |  |
| `object` | → Comment \| → Post | always |  |
| `result` | → Comment | always |  |

#### `agent` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | …{by}… |
| `description` | text | always | = "Bread and bikes." |

#### `object` → `Comment` | `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(parent) |
| `url` | text | always | …{parent}… |
| `body` | text | sometimes | context.parent.text |
| `author` | list of → Agent | always |  |
| `about` | list of → Post | sometimes |  |
| `name` | text | sometimes | context.parent.title \| context.root.title |
| `references` | list of → Entity | sometimes |  |

#### `object.author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | context.parent.by |
| `url` | text | always | …{context.parent.by}… |
| `sameAs` | list of text | sometimes | = "@me" (seen once) |
| `description` | text | sometimes | = "Bread and bikes." (seen once) |

#### `object.about[]` → `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" (seen once) |
| `sourceId` | text | always | String(context.user.submitted[]) \| String(context.root.id) |
| `url` | text | always | …{context.user.submitted[]}… \| …{context.root.id}… |
| `name` | text | always | context.root.title |
| `author` | list of → Agent | always |  |
| `references` | list of → Entity | always |  |

#### `object.about[].author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" (seen once) |
| `handle` | text | always | by |
| `sameAs` | list of text | always | = "@me" (seen once) |
| `url` | text | always | …{by}… |
| `description` | text | always | = "Bread and bikes." (seen once) |

#### `object.about[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.root.url |

#### `result` → `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `url` | text | always | …{id}… |
| `body` | text | always | computed |
| `author` | list of → Agent | always |  |
| `about` | list of → Post | always |  |

#### `result.author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | …{by}… |
| `description` | text | always | = "Bread and bikes." |

#### `result.about[]` → `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(context.root.id) |
| `url` | text | always | …{context.root.id}… |
| `name` | text | always | context.root.title |
| `author` | list of → Agent | always |  |
| `references` | list of → Entity | always |  |

#### `result.about[].author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | context.root.by |
| `sameAs` | list of text | sometimes | = "@me" |
| `url` | text | always | …{context.root.by}… |
| `description` | text | sometimes | = "Bread and bikes." |

#### `result.about[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.root.url |

#### `object.references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.parent.url \| context.root.url |

## replies

### Input

| Path | Value | Present |
| --- | --- | --- |
| `id` | number | always |
| `time` | number | always |
| `type` | text | always |
| `by` | text | always |
| `parent` | number | always |
| `dead` | boolean | sometimes |
| `text` | text | always |
| `kids[]` | number | sometimes |

### Output

#### `RespondAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `timestamp` | date | always | unix(time) |
| `agent` | → Agent | always |  |
| `object` | → Comment \| → Post | always |  |
| `result` | → Comment | always |  |

#### `agent` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `url` | text | always | …{by}… |

#### `object` → `Comment` | `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(parent) |
| `url` | text | always | …{parent}… |
| `body` | text | sometimes | context.parent.text |
| `author` | list of → Agent | always |  |
| `about` | list of → Post | sometimes |  |
| `name` | text | sometimes | context.parent.title \| context.root.title |
| `references` | list of → Entity | sometimes |  |

#### `object.author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | context.user.id \| context.parent.by |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | …{context.user.id}… \| …{context.parent.by}… |
| `description` | text | always | = "Bread and bikes." |

#### `object.about[]` → `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" (seen once) |
| `sourceId` | text | always | String(context.parent.parent) \| String(context.root.id) |
| `url` | text | always | …{context.parent.parent}… \| …{context.root.id}… |
| `name` | text | always | context.root.title |
| `author` | list of → Agent | always |  |
| `references` | list of → Entity | always |  |

#### `object.about[].author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" (seen once) |
| `handle` | text | always | by |
| `url` | text | always | …{by}… |

#### `object.about[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.root.url |

#### `result` → `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(id) |
| `url` | text | always | …{id}… |
| `body` | text | always | computed |
| `author` | list of → Agent | always |  |
| `about` | list of → Post | always |  |

#### `result.author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | by |
| `url` | text | always | …{by}… |

#### `result.about[]` → `Post`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `sourceId` | text | always | String(context.root.id) |
| `url` | text | always | …{context.root.id}… |
| `name` | text | always | context.root.title |
| `author` | list of → Agent | always |  |
| `references` | list of → Entity | always |  |

#### `result.about[].author[]` → `Agent`

Key: `@type, source, handle`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "hackernews" |
| `handle` | text | always | context.root.by |
| `url` | text | always | …{context.root.by}… |
| `sameAs` | list of text | sometimes | = "@me" (seen once) |
| `description` | text | sometimes | = "Bread and bikes." (seen once) |

#### `result.about[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.root.url |

#### `object.references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | context.parent.url \| context.root.url |
