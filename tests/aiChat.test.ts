import { describe, expect, it } from 'vitest'
import { describeMap, parseReply, systemPrompt } from '../src/lib/aiChat'
import { newProject } from '../src/lib/project'

describe('AI chat', () => {
  it('reads replies in a code fence, after a sentence, or as plain text', () => {
    const json = '{"reply":"Done","actions":[{"do":"turn","index":1,"degrees":90},{"nope":1}]}'
    expect(parseReply('```json\n' + json + '\n```')).toEqual({ reply: 'Done', actions: [{ do: 'turn', index: 1, degrees: 90 }] })
    expect(parseReply('Sure! ' + json).actions).toHaveLength(1)
    expect(parseReply('Just words.')).toEqual({ reply: 'Just words.', actions: [] })
  })

  it('describes the map and lists the edits it may use', () => {
    const p = newProject('Test')
    p.markers = [{ ...p.markers[0], type: 'Shared spawn', position: [1, 1, 2] } as never]
    const text = describeMap(p)
    expect(text).toContain('Shared spawn ×1')
    const sys = systemPrompt(text)
    expect(sys).toContain('"do":"add_prefab"')
    expect(sys).toContain('bench (Bench')
    expect(sys).toContain('sniper_rifle')
  })
})
