import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubLayoutPromptFile } from '../layout-prompt.js';
import { githubByEditedAliasPath } from '../path-mapper.js';

describe('github layout prompt', () => {
  it('emits the integration layout guide at the github root', () => {
    const file = githubLayoutPromptFile();

    assert.equal(file.path, '/github/LAYOUT.md');
    assert.equal(file.contentType, 'text/markdown; charset=utf-8');
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /\bjq\b/u);
    assert.match(file.content, /__/u);
    assert.match(file.content, /_index\.json/u);
    assert.match(file.content, /by-edited\/YYYY-MM-DD/u);
    assert.match(file.content, /"merged": true/u);
    assert.match(file.content, /select\(\.mergedAt != null\)/u);
    assert.match(file.content, /discovery\/github\/repos\/\{owner\}\/\{repo\}\/issues\/\.schema\.json/u);
    assert.match(file.content, /discovery\/github\/repos\/\{owner\}\/\{repo\}\/issues\/\.create\.example\.json/u);
    assert.match(file.content, /discovery\/github\/repos\/\{owner\}\/\{repo\}\/pulls\/\{pullNumber\}\/reviews\/\.schema\.json/u);
    assert.match(file.content, /\/github\/repos\/<owner>__<repo>\/<issues\|pulls>\/\.\.\./u);
    const byEditedAliasPath = githubByEditedAliasPath('octocat', 'hello-world', 'issues', '2026-05-12', 42);
    assert.ok(file.content.includes(`ls ${byEditedAliasPath.replace('/42.json', '')}`));
    assert.ok(file.content.includes(`jq '.title' ${byEditedAliasPath}`));
    assert.doesNotMatch(file.content, /\/github\/repos\/octocat\/hello-world\/issues\/by-edited\/2026-05-12/u);
  });
});
