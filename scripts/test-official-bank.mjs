import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const bank = read('data/official-content.json');
const catalog = read('dist/data/courses.json');
const manifest = read('dist/data/cebraspe-ti-questions.json');
const course = catalog.courses.find(c => c.id === 'cebraspe-ti');

test('official bank is complete across published parts and isolated from authored lessons', () => {
  assert.ok(course?.practiceOnly);
  assert.equal(course.total, bank.questions.length);
  assert.equal(manifest.total, bank.questions.length);
  assert.equal(catalog.total, catalog.questions.length + bank.questions.length);
  assert.ok(catalog.questions.every(q => q.origin === 'autoral'));
  const published = manifest.parts.flatMap(url => {
    assert.match(url, /^\/data\/cebraspe-ti\/part-\d+\.json\?v=concursos-4$/);
    const file = path.join('dist', url.split('?')[0]);
    assert.ok(statSync(file).size < 4 * 1024 * 1024 + 100);
    return read(file).questions;
  });
  assert.deepEqual(published, bank.questions);
  assert.deepEqual(course.questionIds, bank.questions.map(q => q.id));
});

test('each imported item retains a unique source, definitive answer and original page', () => {
  const ids = new Set(), sourceItems = new Set(), assets = new Set();
  for (const q of bank.questions) {
    assert.ok(!ids.has(q.id), `duplicate ID: ${q.id}`); ids.add(q.id);
    const identity = `${q.sourceSha256}:${q.index}`;
    assert.ok(!sourceItems.has(identity), `duplicate source item: ${identity}`); sourceItems.add(identity);
    assert.equal(q.origin, 'oficial');
    assert.equal(q.annulled, false);
    assert.equal(q.answerKeyStatus, 'definitivo');
    assert.equal(q.explanation, null);
    assert.ok(q.paperCode && q.examId);
    assert.match(q.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(q.answerKeySha256, /^[a-f0-9]{64}$/);
    for (const url of [q.sourceUrl, q.answerKeyUrl]) assert.ok(['www.cespe.unb.br','www.cebraspe.org.br','cdn.cebraspe.org.br'].includes(new URL(url).hostname), url);
    assert.equal(q.alternatives.filter(a => a.isCorrect).length, 1);
    assert.equal(q.alternatives.find(a => a.isCorrect).letter, q.correctAlternative);
    if (q.format === 'certo-errado') assert.deepEqual(q.alternatives.map(a => a.letter), ['C','E']);
    else assert.ok(['ABCD','ABCDE'].includes(q.alternatives.map(a => a.letter).join('')));
    const target = q.images.find(i => i.page === q.sourcePage);
    assert.ok(target?.marker && !target.support, q.id);
    assert.equal(q.images[0].page, q.sourcePage);
    assert.ok(q.sourcePages.includes(q.sourcePage));
    for (const i of q.images) {
      assert.match(i.src, /^\/assets\/questions\/cebraspe\/[a-f0-9]{20}-p\d+\.webp$/);
      assert.ok(q.sourcePages.includes(i.page));
      if (i.marker) for (const value of Object.values(i.marker)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
      assets.add(i.src);
    }
  }
  assert.equal(assets.size, bank.summary.sourcePages);
  for (const src of assets) {
    const bytes = readFileSync(path.join('dist', src));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', src);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', src);
  }
});
