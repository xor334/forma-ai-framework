import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export function createService() {
  return createServer((request, response) => {
    const ready = request.method === 'GET' && request.url === '/health'
    response.writeHead(ready ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify(ready ? { ok: true } : { error: 'Unknown route' }))
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createService().listen(8080, '0.0.0.0')
}
