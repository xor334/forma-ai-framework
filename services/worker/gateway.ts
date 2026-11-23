export async function complete(instruction: string, context: unknown, json = false) {
  const endpoint = process.env.MODEL_ENDPOINT
  if (!endpoint || !process.env.MODEL_NAME) throw Error('Настройте профиль модели')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.MODEL_KEY) headers.Authorization = 'Bearer ' + process.env.MODEL_KEY
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: process.env.MODEL_NAME,
      max_tokens: json ? 450 : 1000,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify(context) },
      ],
    }),
  })
  if (!response.ok) throw Error('Шлюз недоступен')
  const content = (await response.json()).choices?.[0]?.message?.content
  if (typeof content !== 'string') throw Error('Пустой ответ модели')
  return content
}
