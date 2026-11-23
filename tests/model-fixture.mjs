import { createServer } from 'node:http'
createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  const text = input.response_format
    ? JSON.stringify({ field: 'title', value: 'Заголовок от модели' })
    : 'Проверить число обращений за выбранную неделю.'
  const output =
    request.url === '/embed'
      ? { data: [{ embedding: [1, 0, 0] }] }
      : { choices: [{ message: { content: text } }] }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(output))
}).listen(3900)
