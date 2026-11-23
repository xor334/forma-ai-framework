import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  TextInput,
  Linking,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
const endpoint = (process.env.EXPO_PUBLIC_FORMA_URL || '').replace(/\/$/, '')
const theme = StyleSheet.create({
  screen: { paddingHorizontal: 16, paddingVertical: 50, gap: 12 },
  block: { padding: 18, backgroundColor: '#f1eee7', borderRadius: 10 },
  heading: { fontSize: 24, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#829990', padding: 10 },
  button: { fontWeight: '600', color: '#245c47', paddingVertical: 10 },
})
export default function App() {
  const [model, setModel] = useState(null),
    [info, setInfo] = useState(''),
    [contact, setContact] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const list = useRef(null),
    offsets = useRef({}),
    pending = useRef(null)
  const { width } = useWindowDimensions(),
    size = width >= 1120 ? 'wide' : width >= 768 ? 'tablet' : 'phone'
  useEffect(() => {
    let current = true
    // Each business build owns its cache. Separate layouts when rotating or resizing.
    const cache = new File(Paths.document, 'forma-page-' + size + '.json')
    async function refresh() {
      try {
        if (cache.exists) {
          const cached = JSON.parse(await cache.text())
          if (current && cached.endpoint === endpoint) setModel(cached.model)
        }
      } catch {}
      try {
        if (!endpoint) throw Error('Укажите EXPO_PUBLIC_FORMA_URL при сборке')
        const r = await fetch(
          endpoint + '/api/v1/page?schema=2&generation=3&platform=' + Platform.OS + '&size=' + size,
        )
        if (!r.ok) throw Error('Выпуск временно недоступен')
        const { model: next } = await r.json()
        if (!Array.isArray(next?.widgets)) throw Error('Несовместимый выпуск')
        if (current) {
          setModel(next)
          setInfo('')
          cache.write(JSON.stringify({ endpoint, model: next }))
        }
      } catch (e) {
        if (current) setInfo(e.message)
      }
    }
    refresh()
    return () => {
      current = false
    }
  }, [size])
  async function order() {
    if (!contact.trim() || !message.trim() || busy) return
    setBusy(true)
    const body = JSON.stringify({ contact, message })
    if (pending.current?.body !== body) pending.current = { body, id: randomUUID() }
    try {
      const r = await fetch(endpoint + '/api/v1/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.current.id, contact, message }),
      })
      if (!r.ok) throw Error('Не удалось отправить заявку')
      setMessage('')
      pending.current = null
      setInfo('Заявка принята')
    } catch (e) {
      setInfo(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <ScrollView ref={list} contentContainerStyle={theme.screen}>
      <Text accessibilityLiveRegion="polite">{info}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {model?.widgets.map((w) => (
          <View
            key={w.testID}
            testID={w.testID}
            onLayout={(e) => {
              offsets.current[w.testID] = e.nativeEvent.layout.y
            }}
            style={[
              theme.block,
              {
                width: (w.layout.widthPercent ?? (w.layout.span * 100) / 12) + '%',
                minHeight: w.layout.minHeightPx ?? 0,
              },
            ]}
          >
            {w.children.map((c, i) =>
              c.component === 'Image' ? (
                <Image
                  key={i}
                  source={{ uri: endpoint + c.path }}
                  accessibilityLabel={c.alt}
                  style={{ width: '100%', height: 180 }}
                  resizeMode="contain"
                />
              ) : c.component === 'Text' ? (
                <Text
                  key={i}
                  accessibilityRole={c.accessibilityRole}
                  style={c.accessibilityRole === 'header' ? theme.heading : undefined}
                >
                  {c.text}
                </Text>
              ) : (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  onPress={() => {
                    if (c.action.kind === 'section')
                      list.current?.scrollTo({ y: offsets.current[c.action.target] ?? 0 })
                    if (c.action.kind === 'email')
                      Linking.openURL('mailto:' + c.action.target).catch(() =>
                        setInfo('Почта недоступна'),
                      )
                  }}
                >
                  <Text style={theme.button}>{c.label}</Text>
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
      <Text style={theme.heading}>Оставить заявку</Text>
      <TextInput
        accessibilityLabel="Контакт"
        placeholder="Как с вами связаться"
        maxLength={240}
        style={theme.input}
        value={contact}
        onChangeText={setContact}
      />
      <TextInput
        accessibilityLabel="Сообщение"
        placeholder="Сообщение"
        maxLength={2000}
        style={theme.input}
        value={message}
        onChangeText={setMessage}
      />
      <Pressable accessibilityRole="button" disabled={busy} onPress={order}>
        <Text style={theme.button}>Отправить</Text>
      </Pressable>
    </ScrollView>
  )
}
