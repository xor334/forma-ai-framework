import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { initProject } from './init-project.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'forma-fork-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('один профиль на форк: два конкурентных запуска сохраняют ровно один файл', async t => {
  const root = await fixture(t);
  const attempts = await Promise.allSettled([initProject(root, 'north', 'Север'), initProject(root, 'south', 'Юг')]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  const saved = JSON.parse(await readFile(join(root,'business','project.json'),'utf8'));
  assert.ok((saved.id === 'north' && saved.name === 'Север') || (saved.id === 'south' && saved.name === 'Юг'));
});

test('идентификатор и название проверяются до создания профиля', async t => {
  const root = await fixture(t);
  await assert.rejects(initProject(root, '../private', 'Магазин'), /ID/);
  await assert.rejects(initProject(root, 'store', ' '), /название/);
});

test('форк принимает изменение upstream и сохраняет свой профиль', async t => {
  const temp = await fixture(t);
  const upstream = join(temp, 'upstream');
  const fork = join(temp, 'business-repo');
  const git = (cwd, ...args) => execFileSync('git', [
    '-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    '-c','commit.gpgSign=false','-c','core.hooksPath=/dev/null',...args
  ], { cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  await mkdir(upstream);
  git(upstream,'init','--quiet','--initial-branch=main');
  await writeFile(join(upstream,'contract.txt'),'v1\n');
  git(upstream,'add','.'); git(upstream,'commit','-qm','Baseline');
  git(temp,'clone','-q','--no-hardlinks',upstream,fork);
  git(fork,'remote','rename','origin','upstream');
  await initProject(fork,'north','Север');
  git(fork,'add','business/project.json'); git(fork,'commit','-qm','Configure business');
  await writeFile(join(upstream,'contract.txt'),'v1.1\n');
  git(upstream,'add','contract.txt'); git(upstream,'commit','-qm','Patch base');
  git(fork,'fetch','-q','upstream'); git(fork,'switch','-qc','upgrade/base');
  git(fork,'merge','-q','--no-edit','upstream/main');
  assert.equal(await readFile(join(fork,'contract.txt'),'utf8'),'v1.1\n');
  assert.equal(JSON.parse(await readFile(join(fork,'business','project.json'),'utf8')).name,'Север');
  assert.equal(git(fork,'status','--porcelain').trim(),'');
});
