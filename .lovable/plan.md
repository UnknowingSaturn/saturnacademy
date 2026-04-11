

# Robust Live Trade Questions Configuration

## Problem
The Live Questions settings panel only supports 3 question types (text, select, rating). There's no support for screenshot/image uploads, no configurable limits (like max images), no required/optional toggle, and no placeholder customization. The compliance panel similarly can't render a screenshot upload field.

## What Changes

### 1. Extend the `LiveTradeQuestion` type (`src/types/settings.ts`)
Add new question types and configuration fields:
- New types: `screenshot`, `checkbox`, `number`
- New optional fields: `maxItems` (for screenshot limits, e.g. 4-5), `required`, `placeholder`, `min`/`max` (for number/rating)

```typescript
export interface LiveTradeQuestion {
  id: string;
  type: 'select' | 'rating' | 'text' | 'screenshot' | 'checkbox' | 'number';
  label: string;
  options?: string[];
  maxItems?: number;      // max screenshots (default 5)
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}
```

### 2. Upgrade the settings panel (`LiveQuestionsPanel.tsx`)
- Add `screenshot`, `checkbox`, `number` to the type dropdown
- Show `maxItems` input (1-10) when type is `screenshot`
- Show `placeholder` input for text/number types
- Show `required` toggle for all types
- Show `min`/`max` inputs for number type
- Show preview of each question's config (e.g. "Max 4 images")
- Add inline edit capability (click existing question to edit, not just add/delete)

### 3. Add screenshot upload renderer in `LiveTradeCompliancePanel.tsx`
- When a question has `type: 'screenshot'`, render a dropzone/file picker
- Use existing `useScreenshots` hook for upload to `trade-screenshots` bucket
- Enforce `maxItems` limit (disable upload button when reached)
- Show thumbnail grid of uploaded images with delete capability
- Save screenshot URLs into `questionAnswers` as JSON array string
- Persist to `trade_reviews.screenshots` on auto-save

### 4. Render other new types in compliance panel
- `checkbox`: single true/false toggle
- `number`: numeric input with optional min/max validation

### 5. Update defaults
Add a default screenshot question to `DEFAULT_LIVE_TRADE_QUESTIONS`:
```typescript
{ id: 'trade_screenshots', type: 'screenshot', label: 'Trade screenshots', maxItems: 5 }
```

## Files Modified
| File | Change |
|------|--------|
| `src/types/settings.ts` | Extend `LiveTradeQuestion` interface with new types and fields |
| `src/components/journal/settings/LiveQuestionsPanel.tsx` | Add new type options, config fields (maxItems, required, placeholder), inline editing |
| `src/components/journal/LiveTradeCompliancePanel.tsx` | Add renderers for screenshot upload, checkbox, and number question types |

## Technical Notes
- Screenshot uploads use the existing `useScreenshots` hook and `trade-screenshots` storage bucket (already public, already has upload/delete)
- No database migration needed — `live_trade_questions` is a JSONB column that already stores arbitrary question shapes
- Screenshot URLs are stored in `trade_reviews.screenshots` (existing JSONB column)
- The `maxItems` field defaults to 5 if not set on a screenshot question

