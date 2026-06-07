import { describe, expect, it } from 'vitest'
import { gradeQuestion, projectPublicPayload } from './grading.js'
import { reviewable } from './index.js'

const policy = { marksPerCorrect: 2, negativeMarks: 0.5 }
const mcq = {
  options: [
    { id: 'a', text: 'One' },
    { id: 'b', text: 'Two' },
  ],
  correctIds: ['b'],
  explanation: 'Two is right',
}

describe('objective grading and publication gate', () => {
  it('does not disclose keys or explanations in a candidate payload', () => {
    const publicPayload = projectPublicPayload('MCQ_SINGLE', mcq, [1, 0])
    expect(publicPayload).toEqual({ options: [mcq.options[1], mcq.options[0]] })
    expect(JSON.stringify(publicPayload)).not.toContain('correctIds')
    expect(JSON.stringify(publicPayload)).not.toContain('explanation')
  })

  it('scores selected options and applies negative marks only to answered questions', () => {
    expect(gradeQuestion('MCQ_SINGLE', mcq, { selected: 'b' }, policy)).toEqual({
      isCorrect: true,
      pointsAwarded: 2,
    })
    expect(gradeQuestion('MCQ_SINGLE', mcq, { selected: 'a' }, policy)).toEqual({
      isCorrect: false,
      pointsAwarded: -0.5,
    })
    expect(gradeQuestion('MCQ_SINGLE', mcq, null, policy)).toEqual({
      isCorrect: false,
      pointsAwarded: 0,
    })
  })

  it('does not turn a blank numeric answer into zero', () => {
    expect(gradeQuestion('NUMERIC', { correct: 0 }, { value: '' }, policy)).toEqual({
      isCorrect: false,
      pointsAwarded: -0.5,
    })
  })

  it('requires independent review and a valid answer key before publication', () => {
    const draft = {
      status: 'draft',
      isAdaptive: false,
      proctorLevel: 'off',
      durationMinutes: 10,
      sections: [
        {
          name: 'Reasoning',
          durationMinutes: 10,
          numQuestions: 1,
          scoringPolicy: { marksPerCorrect: 1, negativeMarks: 0 },
        },
      ],
      items: [
        {
          section: 'Reasoning',
          weight: 1,
          question: {
            type: 'MCQ_SINGLE',
            status: 'DRAFT',
            authorId: 'author',
            payload: mcq,
          },
        },
      ],
    }
    expect(reviewable(draft, 'reviewer')).toBe(true)
    expect(reviewable(draft, 'author')).toBe(false)
    expect(
      reviewable(
        {
          ...draft,
          items: [
            {
              ...draft.items[0]!,
              question: {
                ...draft.items[0]!.question,
                payload: { ...mcq, correctIds: ['missing'] },
              },
            },
          ],
        },
        'reviewer'
      )
    ).toBe(false)
  })
})
