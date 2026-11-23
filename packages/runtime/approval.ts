import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
type Decision = { id: string; target: string; epoch: number; actor: string }
function message(d: Decision) {
  return Buffer.from(JSON.stringify(['forma.content.approval/1', d.id, d.target, d.epoch, d.actor]))
}
export function signDecision(decision: Decision) {
  if (!process.env.APPROVAL_PRIVATE_KEY) throw Error('Настройте ключ согласования')
  const key = createPrivateKey({
    key: Buffer.from(process.env.APPROVAL_PRIVATE_KEY, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  return sign(null, message(decision), key).toString('base64')
}
export function verified(decision: Decision, signature: string) {
  if (!process.env.APPROVAL_PUBLIC_KEY) throw Error('Настройте ключ проверки выпуска')
  const key = createPublicKey({
    key: Buffer.from(process.env.APPROVAL_PUBLIC_KEY, 'base64'),
    format: 'der',
    type: 'spki',
  })
  return verify(null, message(decision), key, Buffer.from(signature, 'base64'))
}
