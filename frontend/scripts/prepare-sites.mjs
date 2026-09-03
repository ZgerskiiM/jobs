import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const client = join(dist, 'client')
const server = join(dist, 'server')
await rm(client, { recursive: true, force: true })
await mkdir(client, { recursive: true })
for (const entry of await readdir(dist, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') continue
  await cp(join(dist, entry.name), join(client, entry.name), { recursive: true })
}
await mkdir(server, { recursive: true })
await cp(join(root, 'scripts', 'site-worker.js'), join(server, 'index.js'))
await mkdir(join(dist, '.openai'), { recursive: true })
await cp(join(root, '..', '.openai', 'hosting.json'), join(dist, '.openai', 'hosting.json'))
