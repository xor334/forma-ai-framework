import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function initProject(root, id, rawName) {
  const name = (rawName || '').trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id || '') || id.length > 63) {
    throw new Error('ID должен начинаться с латинской буквы и содержать до 63 букв, цифр и разделительных дефисов.');
  }
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error('Укажите название проекта от 1 до 100 символов одной строкой.');
  }
  const dir = join(root, 'business');
  const target = join(dir, 'project.json');
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(target, JSON.stringify({ schemaVersion: 1, id, name }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Профиль business/project.json уже существует. Отредактируйте его в рабочей ветке.');
    throw error;
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Формат: npm run init:project -- project-id "Название проекта"');
    const root = fileURLToPath(new URL('../', import.meta.url));
    await initProject(root, process.argv[2], process.argv[3]);
    process.stdout.write('Создан business/project.json. Проверьте настройки и сохраните их в своём репозитории.\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
