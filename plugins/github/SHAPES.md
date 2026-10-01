# GitHub shapes

Generated from what the transformer makes of the test fixtures. Do not edit:
run `npm run shapes` in this plugin to update it.

For each record type: the paths in its input, the nodes in its output, and
where each output value came from. `[]` is any list element. A value is
copied from an input path; converted (`String`, `lower`, `date`, `unix`);
built around one (`…{path}…`, as a URL around an id); from a different
path each time (`varies`); always the same (`= value`, `seen once` when
the fixtures show it once); or `computed` in the transformer.

## Graph

- Comment —about→ Issue
- Comment —about→ PullRequest
- Comment —author→ Person
- Comment —author→ SoftwareAgent
- Comment —inReplyTo→ Comment
- Comment —isPartOf→ Response
- Issue —author→ Person
- Issue —isPartOf→ Repository
- LikeAction —agent→ Person
- LikeAction —object→ Repository
- PublishAction —agent→ Person
- PublishAction —object→ Issue
- PublishAction —object→ PullRequest
- PublishAction —object→ SoftwareSourceCode
- PullRequest —author→ Person
- PullRequest —isPartOf→ Repository
- Repository —creator→ Organization
- Repository —creator→ Person
- Repository —references→ Entity
- RespondAction —agent→ Person
- RespondAction —agent→ SoftwareAgent
- RespondAction —object→ Issue
- RespondAction —object→ PullRequest
- RespondAction —result→ Comment
- RespondAction —result→ Response
- Response —about→ PullRequest
- Response —author→ Person
- SoftwareSourceCode —author→ Person

## pull-requests

### Input

| Path | Value | Present |
| --- | --- | --- |
| `__typename` | text | always |
| `id` | text | always |
| `number` | number | always |
| `title` | text | always |
| `url` | text | always |
| `createdAt` | text | always |
| `updatedAt` | text | always |
| `author.__typename` | text | always |
| `author.databaseId` | number | always |
| `author.login` | text | always |
| `author.url` | text | always |
| `author.name` | text | always |
| `repository.id` | text | always |
| `repository.name` | text | always |
| `repository.nameWithOwner` | text | always |
| `repository.url` | text | always |
| `repository.description` | text | always |
| `repository.homepageUrl` | text | always |
| `repository.visibility` | text | always |
| `repository.repositoryTopics.nodes[].topic.name` | text | always |
| `repository.owner.__typename` | text | always |
| `repository.owner.databaseId` | number | always |
| `repository.owner.login` | text | always |
| `repository.owner.url` | text | always |
| `repository.owner.name` | text | always |
| `body` | text | always |

### Output

#### `PublishAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | id |
| `timestamp` | date | always | date(createdAt) |
| `agent` | → Person | always |  |
| `object` | → PullRequest | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | author.url \| repository.owner.url |

#### `object` → `PullRequest`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | id |
| `url` | text | always | url |
| `name` | text | always | title |
| `body` | text | sometimes | body |
| `datePublished` | date | always | date(createdAt) |
| `author` | list of → Person | always |  |
| `isPartOf` | list of → Repository | always |  |
| `visibility` | text | always | lower(repository.visibility) |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | author.url \| repository.owner.url |

#### `object.isPartOf[]` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `url` | text | always | repository.url |
| `name` | text | always | repository.name |
| `description` | text | always | repository.description |
| `references` | list of → Entity | always |  |
| `tags` | list of text | always | repository.repositoryTopics.nodes[].topic.name |
| `creator` | list of → Person | always |  |
| `visibility` | text | always | lower(repository.visibility) |

#### `object.isPartOf[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | repository.homepageUrl |

#### `object.isPartOf[].creator[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | author.url \| repository.owner.url |

## issues

### Input

| Path | Value | Present |
| --- | --- | --- |
| `__typename` | text | always |
| `id` | text | always |
| `number` | number | always |
| `title` | text | always |
| `url` | text | always |
| `createdAt` | text | always |
| `updatedAt` | text | always |
| `author.__typename` | text | always |
| `author.databaseId` | number | always |
| `author.login` | text | always |
| `author.url` | text | always |
| `author.name` | text | always |
| `repository.id` | text | always |
| `repository.name` | text | always |
| `repository.nameWithOwner` | text | always |
| `repository.url` | text | always |
| `repository.description` | text | always |
| `repository.homepageUrl` | text | always |
| `repository.visibility` | text | always |
| `repository.repositoryTopics.nodes[].topic.name` | text | always |
| `repository.owner.__typename` | text | always |
| `repository.owner.databaseId` | number | always |
| `repository.owner.login` | text | always |
| `repository.owner.url` | text | always |
| `repository.owner.name` | text | always |
| `body` | text | always |

### Output

#### `PublishAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | id |
| `timestamp` | date | always | date(createdAt) |
| `agent` | → Person | always |  |
| `object` | → Issue | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" (seen once) |
| `url` | text | always | author.url \| repository.owner.url |

#### `object` → `Issue`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | id |
| `url` | text | always | url |
| `name` | text | always | title |
| `body` | text | always | body |
| `datePublished` | date | always | date(createdAt) |
| `author` | list of → Person | always |  |
| `isPartOf` | list of → Repository | always |  |
| `visibility` | text | always | lower(repository.visibility) |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" (seen once) |
| `url` | text | always | author.url \| repository.owner.url |

#### `object.isPartOf[]` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `url` | text | always | repository.url |
| `name` | text | always | repository.name |
| `description` | text | always | repository.description |
| `references` | list of → Entity | always |  |
| `tags` | list of text | always | repository.repositoryTopics.nodes[].topic.name |
| `creator` | list of → Person | always |  |
| `visibility` | text | always | lower(repository.visibility) |

#### `object.isPartOf[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | repository.homepageUrl |

#### `object.isPartOf[].creator[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | String(author.databaseId) \| String(repository.owner.databaseId) |
| `handle` | text | always | author.login \| repository.owner.login |
| `name` | text | always | author.name \| repository.owner.name |
| `sameAs` | list of text | always | = "@me" (seen once) |
| `url` | text | always | author.url \| repository.owner.url |

## comments

### Input

| Path | Value | Present |
| --- | --- | --- |
| `comment.id` | text | always |
| `comment.body` | text | always |
| `comment.url` | text | always |
| `comment.createdAt` | text | always |
| `comment.author.__typename` | text | always |
| `comment.author.databaseId` | number | always |
| `comment.author.login` | text | always |
| `comment.author.url` | text | always |
| `comment.author.name` | text | always |
| `thread.__typename` | text | always |
| `thread.id` | text | always |
| `thread.number` | number | always |
| `thread.title` | text | always |
| `thread.url` | text | always |
| `thread.createdAt` | text | always |
| `thread.updatedAt` | text | always |
| `thread.author.__typename` | text | always |
| `thread.author.databaseId` | number | always |
| `thread.author.login` | text | always |
| `thread.author.url` | text | always |
| `thread.author.name` | text \| null | sometimes |
| `thread.repository.id` | text | always |
| `thread.repository.name` | text | always |
| `thread.repository.nameWithOwner` | text | always |
| `thread.repository.url` | text | always |
| `thread.repository.description` | text \| null | sometimes |
| `thread.repository.homepageUrl` | text \| null | sometimes |
| `thread.repository.visibility` | text | always |
| `thread.repository.repositoryTopics.nodes[].topic.name` | text | sometimes |
| `thread.repository.owner.__typename` | text | always |
| `thread.repository.owner.databaseId` | number | always |
| `thread.repository.owner.login` | text | always |
| `thread.repository.owner.url` | text | always |
| `thread.repository.owner.name` | text | always |
| `thread.repository.repositoryTopics.nodes` | empty list | sometimes |

### Output

#### `RespondAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | comment.id |
| `timestamp` | date | always | date(comment.createdAt) |
| `agent` | → Person | always |  |
| `object` | → PullRequest \| → Issue | always |  |
| `result` | → Comment | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(comment.author.databaseId) |
| `handle` | text | always | comment.author.login |
| `name` | text | always | comment.author.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | comment.author.url |

#### `object` → `PullRequest` | `Issue`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | thread.id |
| `url` | text | always | thread.url |
| `name` | text | always | thread.title |
| `datePublished` | date | always | date(thread.createdAt) |
| `author` | list of → Person | always |  |
| `isPartOf` | list of → Repository | always |  |
| `visibility` | text | always | lower(thread.repository.visibility) |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(thread.author.databaseId) |
| `handle` | text | always | thread.author.login |
| `name` | text | sometimes | thread.author.name |
| `sameAs` | list of text | sometimes | = "@me" |
| `url` | text | always | thread.author.url |

#### `object.isPartOf[]` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `url` | text | always | thread.repository.url |
| `name` | text | always | thread.repository.name |
| `description` | text | sometimes | thread.repository.description |
| `references` | list of → Entity | sometimes |  |
| `tags` | list of text | sometimes | thread.repository.repositoryTopics.nodes[].topic.name |
| `creator` | list of → Person \| → Organization | always |  |
| `visibility` | text | always | lower(thread.repository.visibility) |

#### `object.isPartOf[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | thread.repository.homepageUrl |

#### `object.isPartOf[].creator[]` → `Person` | `Organization`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(thread.repository.owner.databaseId) |
| `handle` | text | always | thread.repository.owner.login |
| `name` | text | always | thread.repository.owner.name |
| `sameAs` | list of text | sometimes | = "@me" |
| `url` | text | always | thread.repository.owner.url |

#### `result` → `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | comment.id |
| `url` | text | always | comment.url |
| `body` | text | always | comment.body |
| `author` | list of → Person | always |  |
| `about` | list of → PullRequest \| → Issue | always |  |
| `visibility` | text | always | lower(thread.repository.visibility) |

#### `result.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(comment.author.databaseId) |
| `handle` | text | always | comment.author.login |
| `name` | text | always | comment.author.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | comment.author.url |

#### `result.about[]` → `PullRequest` | `Issue`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | thread.id |

## reviews

### Input

| Path | Value | Present |
| --- | --- | --- |
| `review.id` | text | always |
| `review.state` | text | always |
| `review.body` | text | always |
| `review.url` | text | always |
| `review.submittedAt` | text | always |
| `review.createdAt` | text | always |
| `review.author.__typename` | text | always |
| `review.author.databaseId` | number | always |
| `review.author.login` | text | always |
| `review.author.url` | text | always |
| `review.author.name` | text | always |
| `comments[].id` | text | always |
| `comments[].body` | text | always |
| `comments[].url` | text | always |
| `comments[].createdAt` | text | always |
| `comments[].author.__typename` | text | always |
| `comments[].author.databaseId` | number | always |
| `comments[].author.login` | text | always |
| `comments[].author.url` | text | always |
| `comments[].author.name` | text | always |
| `comments[].replyTo.id` | text | sometimes |
| `comments[].pullRequestReview.id` | text | always |
| `pullRequest.__typename` | text | always |
| `pullRequest.id` | text | always |
| `pullRequest.number` | number | always |
| `pullRequest.title` | text | always |
| `pullRequest.url` | text | always |
| `pullRequest.createdAt` | text | always |
| `pullRequest.updatedAt` | text | always |
| `pullRequest.author.__typename` | text | always |
| `pullRequest.author.databaseId` | number | always |
| `pullRequest.author.login` | text | always |
| `pullRequest.author.url` | text | always |
| `pullRequest.author.name` | text | always |
| `pullRequest.repository.id` | text | always |
| `pullRequest.repository.name` | text | always |
| `pullRequest.repository.nameWithOwner` | text | always |
| `pullRequest.repository.url` | text | always |
| `pullRequest.repository.description` | text \| null | sometimes |
| `pullRequest.repository.homepageUrl` | text \| null | sometimes |
| `pullRequest.repository.visibility` | text | always |
| `pullRequest.repository.repositoryTopics.nodes[].topic.name` | text | sometimes |
| `pullRequest.repository.owner.__typename` | text | always |
| `pullRequest.repository.owner.databaseId` | number | always |
| `pullRequest.repository.owner.login` | text | always |
| `pullRequest.repository.owner.url` | text | always |
| `pullRequest.repository.owner.name` | text | always |
| `comments[].replyTo` | null | sometimes |
| `pullRequest.repository.repositoryTopics.nodes` | empty list | sometimes |

### Output

#### `RespondAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: comments[].id \| review.id \| comments[].pullRequestReview.id |
| `timestamp` | date | always | date(review.submittedAt) \| date(review.createdAt) \| date(comments[].createdAt) |
| `agent` | → Person | always |  |
| `object` | → PullRequest | always |  |
| `result` | → Comment \| → Response | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(review.author.databaseId) \| String(comments[].author.databaseId) |
| `handle` | text | always | review.author.login \| comments[].author.login |
| `name` | text | always | review.author.name \| comments[].author.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | review.author.url \| comments[].author.url |

#### `object` → `PullRequest`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | pullRequest.id |
| `url` | text | always | pullRequest.url |
| `name` | text | always | pullRequest.title |
| `datePublished` | date | always | date(pullRequest.createdAt) |
| `author` | list of → Person | always |  |
| `isPartOf` | list of → Repository | always |  |
| `visibility` | text | always | lower(pullRequest.repository.visibility) |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(pullRequest.author.databaseId) |
| `handle` | text | always | pullRequest.author.login |
| `name` | text | always | pullRequest.author.name |
| `sameAs` | list of text | sometimes | = "@me" (seen once) |
| `url` | text | always | pullRequest.author.url |

#### `object.isPartOf[]` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `url` | text | always | pullRequest.repository.url |
| `name` | text | always | pullRequest.repository.name |
| `description` | text | sometimes | pullRequest.repository.description |
| `references` | list of → Entity | sometimes |  |
| `tags` | list of text | sometimes | pullRequest.repository.repositoryTopics.nodes[].topic.name |
| `creator` | list of → Person \| → Organization | always |  |
| `visibility` | text | always | lower(pullRequest.repository.visibility) |

#### `object.isPartOf[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | pullRequest.repository.homepageUrl |

#### `object.isPartOf[].creator[]` → `Person` | `Organization`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(pullRequest.repository.owner.databaseId) |
| `handle` | text | always | pullRequest.repository.owner.login |
| `name` | text | always | pullRequest.repository.owner.name |
| `sameAs` | list of text | sometimes | = "@me" (seen once) |
| `url` | text | always | pullRequest.repository.owner.url |

#### `result` → `Comment` | `Response`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: comments[].id \| review.id \| comments[].pullRequestReview.id |
| `url` | text | always | …{pullRequest.url}… \| …{pullRequest.repository.name}… \| …{pullRequest.repository.nameWithOwner}… |
| `body` | text | always | varies: comments[].body \| review.body |
| `author` | list of → Person | always |  |
| `about` | list of → PullRequest | always |  |
| `visibility` | text | always | lower(pullRequest.repository.visibility) |
| `isPartOf` | list of → Response | sometimes |  |
| `inReplyTo` | list of → Comment | sometimes |  |
| `ratingValue` | text | sometimes | review.state |

#### `result.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(review.author.databaseId) \| String(comments[].author.databaseId) |
| `handle` | text | always | review.author.login \| comments[].author.login |
| `name` | text | always | review.author.name \| comments[].author.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | review.author.url \| comments[].author.url |

#### `result.about[]` → `PullRequest`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | pullRequest.id |

#### `result.isPartOf[]` → `Response`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | review.id \| comments[].pullRequestReview.id |

#### `result.inReplyTo[]` → `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | comments[].replyTo.id |

## replies

### Input

| Path | Value | Present |
| --- | --- | --- |
| `kind` | text | always |
| `review.id` | text | sometimes |
| `review.state` | text | sometimes |
| `review.body` | text | sometimes |
| `review.url` | text | sometimes |
| `review.submittedAt` | text | sometimes |
| `review.createdAt` | text | sometimes |
| `review.author.__typename` | text | sometimes |
| `review.author.databaseId` | number | sometimes |
| `review.author.login` | text | sometimes |
| `review.author.url` | text | sometimes |
| `review.author.name` | text | sometimes |
| `comments[].id` | text | sometimes |
| `comments[].body` | text | sometimes |
| `comments[].url` | text | sometimes |
| `comments[].createdAt` | text | sometimes |
| `comments[].author.__typename` | text | sometimes |
| `comments[].author.databaseId` | number | sometimes |
| `comments[].author.login` | text | sometimes |
| `comments[].author.url` | text | sometimes |
| `comments[].author.name` | text | sometimes |
| `comments[].replyTo` | null | sometimes |
| `comments[].pullRequestReview.id` | text | sometimes |
| `pullRequest.__typename` | text | sometimes |
| `pullRequest.id` | text | sometimes |
| `pullRequest.number` | number | sometimes |
| `pullRequest.title` | text | sometimes |
| `pullRequest.url` | text | sometimes |
| `pullRequest.createdAt` | text | sometimes |
| `pullRequest.updatedAt` | text | sometimes |
| `pullRequest.author.__typename` | text | sometimes |
| `pullRequest.author.databaseId` | number | sometimes |
| `pullRequest.author.login` | text | sometimes |
| `pullRequest.author.url` | text | sometimes |
| `pullRequest.author.name` | text | sometimes |
| `pullRequest.repository.id` | text | sometimes |
| `pullRequest.repository.name` | text | sometimes |
| `pullRequest.repository.nameWithOwner` | text | sometimes |
| `pullRequest.repository.url` | text | sometimes |
| `pullRequest.repository.description` | text \| null | sometimes |
| `pullRequest.repository.homepageUrl` | text \| null | sometimes |
| `pullRequest.repository.visibility` | text | sometimes |
| `pullRequest.repository.repositoryTopics.nodes[].topic.name` | text | sometimes |
| `pullRequest.repository.owner.__typename` | text | sometimes |
| `pullRequest.repository.owner.databaseId` | number | sometimes |
| `pullRequest.repository.owner.login` | text | sometimes |
| `pullRequest.repository.owner.url` | text | sometimes |
| `pullRequest.repository.owner.name` | text | sometimes |
| `comment.id` | text | sometimes |
| `comment.body` | text | sometimes |
| `comment.url` | text | sometimes |
| `comment.createdAt` | text | sometimes |
| `comment.author.__typename` | text | sometimes |
| `comment.author.databaseId` | number | sometimes |
| `comment.author.login` | text | sometimes |
| `comment.author.url` | text | sometimes |
| `comment.author.name` | text \| null | sometimes |
| `thread.__typename` | text | sometimes |
| `thread.id` | text | sometimes |
| `thread.number` | number | sometimes |
| `thread.title` | text | sometimes |
| `thread.url` | text | sometimes |
| `thread.createdAt` | text | sometimes |
| `thread.updatedAt` | text | sometimes |
| `thread.author.__typename` | text | sometimes |
| `thread.author.databaseId` | number | sometimes |
| `thread.author.login` | text | sometimes |
| `thread.author.url` | text | sometimes |
| `thread.author.name` | text \| null | sometimes |
| `thread.repository.id` | text | sometimes |
| `thread.repository.name` | text | sometimes |
| `thread.repository.nameWithOwner` | text | sometimes |
| `thread.repository.url` | text | sometimes |
| `thread.repository.description` | text \| null | sometimes |
| `thread.repository.homepageUrl` | text \| null | sometimes |
| `thread.repository.visibility` | text | sometimes |
| `thread.repository.repositoryTopics.nodes[].topic.name` | text | sometimes |
| `thread.repository.owner.__typename` | text | sometimes |
| `thread.repository.owner.databaseId` | number | sometimes |
| `thread.repository.owner.login` | text | sometimes |
| `thread.repository.owner.url` | text | sometimes |
| `thread.repository.owner.name` | text | sometimes |
| `comment.replyTo.id` | text | sometimes |
| `comment.pullRequestReview.id` | text | sometimes |
| `pullRequest.repository.repositoryTopics.nodes` | empty list | sometimes |
| `thread.repository.repositoryTopics.nodes` | empty list | sometimes |

### Output

#### `RespondAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: review.id \| comments[].pullRequestReview.id \| comments[].id \| comment.id |
| `timestamp` | date | always | varies: date(review.submittedAt) \| date(review.createdAt) \| date(comments[].createdAt) \| date(comment.createdAt) |
| `agent` | → Person \| → SoftwareAgent | always |  |
| `object` | → PullRequest \| → Issue | always |  |
| `result` | → Response \| → Comment | always |  |

#### `agent` → `Person` | `SoftwareAgent`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `sourceId` | text | always | varies: String(review.author.databaseId) \| String(comments[].author.databaseId) \| String(comment.author.databaseId) \| String(pullRequest.author.databaseId) \| … |
| `source` | text | always | = "github" |
| `handle` | text | always | varies: review.author.login \| comments[].author.login \| comment.author.login \| pullRequest.author.login \| … |
| `name` | text | sometimes | varies: review.author.name \| comments[].author.name \| comment.author.name \| pullRequest.author.name \| … |
| `url` | text | always | varies: review.author.url \| comments[].author.url \| comment.author.url \| pullRequest.author.url \| … |

#### `object` → `PullRequest` | `Issue`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: pullRequest.id \| thread.id |
| `url` | text | always | varies: pullRequest.url \| thread.url |
| `name` | text | always | varies: pullRequest.title \| thread.title |
| `datePublished` | date | always | varies: date(pullRequest.createdAt) \| date(thread.createdAt) |
| `author` | list of → Person | always |  |
| `isPartOf` | list of → Repository | always |  |
| `visibility` | text | always | varies: lower(pullRequest.repository.visibility) \| lower(thread.repository.visibility) |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: String(pullRequest.author.databaseId) \| String(pullRequest.repository.owner.databaseId) \| String(thread.author.databaseId) \| String(thread.repository.owner.databaseId) \| … |
| `handle` | text | always | varies: pullRequest.author.login \| pullRequest.repository.owner.login \| thread.author.login \| thread.repository.owner.login \| … |
| `name` | text | sometimes | varies: pullRequest.author.name \| pullRequest.repository.owner.name \| thread.author.name \| thread.repository.owner.name \| … |
| `sameAs` | list of text | sometimes | = "@me" |
| `url` | text | always | varies: pullRequest.author.url \| pullRequest.repository.owner.url \| thread.author.url \| thread.repository.owner.url \| … |

#### `object.isPartOf[]` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `url` | text | always | varies: pullRequest.repository.url \| thread.repository.url |
| `name` | text | always | varies: pullRequest.repository.name \| thread.repository.name |
| `description` | text | sometimes | varies: pullRequest.repository.description \| thread.repository.description |
| `references` | list of → Entity | sometimes |  |
| `tags` | list of text | sometimes | varies: pullRequest.repository.repositoryTopics.nodes[].topic.name \| thread.repository.repositoryTopics.nodes[].topic.name |
| `creator` | list of → Person \| → Organization | always |  |
| `visibility` | text | always | varies: lower(pullRequest.repository.visibility) \| lower(thread.repository.visibility) |

#### `object.isPartOf[].references[]` → `Entity`

Key: `url`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `url` | text | always | varies: pullRequest.repository.homepageUrl \| thread.repository.homepageUrl |

#### `object.isPartOf[].creator[]` → `Person` | `Organization`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: String(pullRequest.author.databaseId) \| String(pullRequest.repository.owner.databaseId) \| String(thread.author.databaseId) \| String(thread.repository.owner.databaseId) |
| `handle` | text | always | varies: pullRequest.author.login \| pullRequest.repository.owner.login \| thread.author.login \| thread.repository.owner.login |
| `name` | text | always | varies: pullRequest.author.name \| pullRequest.repository.owner.name \| thread.author.name \| thread.repository.owner.name |
| `sameAs` | list of text | sometimes | = "@me" |
| `url` | text | always | varies: pullRequest.author.url \| pullRequest.repository.owner.url \| thread.author.url \| thread.repository.owner.url |

#### `result` → `Response` | `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: review.id \| comments[].pullRequestReview.id \| comments[].id \| comment.id |
| `url` | text | always | varies: review.url \| comments[].url \| comment.url |
| `body` | text | always | varies: review.body \| comments[].body \| comment.body |
| `ratingValue` | text | sometimes | review.state |
| `author` | list of → Person \| → SoftwareAgent | always |  |
| `about` | list of → PullRequest \| → Issue | always |  |
| `visibility` | text | always | varies: lower(pullRequest.repository.visibility) \| lower(thread.repository.visibility) |
| `isPartOf` | list of → Response | sometimes |  |
| `inReplyTo` | list of → Comment | sometimes |  |

#### `result.author[]` → `Person` | `SoftwareAgent`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `sourceId` | text | always | varies: String(review.author.databaseId) \| String(comments[].author.databaseId) \| String(comment.author.databaseId) \| String(pullRequest.author.databaseId) \| … |
| `source` | text | always | = "github" |
| `handle` | text | always | varies: review.author.login \| comments[].author.login \| comment.author.login \| pullRequest.author.login \| … |
| `name` | text | sometimes | varies: review.author.name \| comments[].author.name \| comment.author.name \| pullRequest.author.name \| … |
| `url` | text | always | varies: review.author.url \| comments[].author.url \| comment.author.url \| pullRequest.author.url \| … |

#### `result.about[]` → `PullRequest` | `Issue`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: pullRequest.id \| thread.id |

#### `result.isPartOf[]` → `Response`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | varies: review.id \| comments[].pullRequestReview.id \| comment.pullRequestReview.id |

#### `result.inReplyTo[]` → `Comment`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" (seen once) |
| `sourceId` | text | always | comment.replyTo.id |

## stars

### Input

| Path | Value | Present |
| --- | --- | --- |
| `starredAt` | text | always |
| `node.id` | text | always |
| `node.name` | text | always |
| `node.nameWithOwner` | text | always |
| `node.url` | text | always |
| `node.description` | null | sometimes |
| `node.homepageUrl` | null | sometimes |
| `node.visibility` | text | always |
| `node.repositoryTopics.nodes` | empty list | always |
| `node.owner.__typename` | text | always |
| `node.owner.databaseId` | number | always |
| `node.owner.login` | text | always |
| `node.owner.url` | text | always |
| `node.owner.name` | null \| text | sometimes |

### Output

#### `LikeAction`

Key: `@type, source, object.creator.sourceId, object.name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `timestamp` | date | always | date(starredAt) |
| `agent` | → Person | always |  |
| `object` | → Repository | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(context.viewer.databaseId) |
| `handle` | text | always | context.viewer.login |
| `name` | text | always | context.viewer.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | context.viewer.url |

#### `object` → `Repository`

Key: `@type, source, creator.sourceId, name`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `url` | text | always | node.url |
| `name` | text | always | node.name |
| `creator` | list of → Person \| → Organization | always |  |
| `visibility` | text | always | lower(node.visibility) |

#### `object.creator[]` → `Person` | `Organization`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `sourceId` | text | always | String(node.owner.databaseId) |
| `source` | text | always | = "github" |
| `handle` | text | always | node.owner.login |
| `url` | text | always | node.owner.url |
| `name` | text | sometimes | node.owner.name |

## gists

### Input

| Path | Value | Present |
| --- | --- | --- |
| `id` | text | always |
| `name` | text | always |
| `description` | text | always |
| `url` | text | always |
| `createdAt` | text | always |
| `isPublic` | boolean | always |
| `files[].name` | text | always |

### Output

#### `PublishAction`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | id |
| `timestamp` | date | always | date(createdAt) |
| `agent` | → Person | always |  |
| `object` | → SoftwareSourceCode | always |  |

#### `agent` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(context.viewer.databaseId) |
| `handle` | text | always | context.viewer.login |
| `name` | text | always | context.viewer.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | context.viewer.url |

#### `object` → `SoftwareSourceCode`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | id |
| `url` | text | always | url |
| `name` | text | always | varies: description \| files[].name |
| `datePublished` | date | always | date(createdAt) |
| `author` | list of → Person | always |  |
| `visibility` | text | always | computed |

#### `object.author[]` → `Person`

Key: `@type, source, sourceId`

| Property | Value | Present | From |
| --- | --- | --- | --- |
| `source` | text | always | = "github" |
| `sourceId` | text | always | String(context.viewer.databaseId) |
| `handle` | text | always | context.viewer.login |
| `name` | text | always | context.viewer.name |
| `sameAs` | list of text | always | = "@me" |
| `url` | text | always | context.viewer.url |
