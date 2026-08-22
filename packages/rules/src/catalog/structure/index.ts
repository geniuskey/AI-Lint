import type { Rule } from '../../types.js'
import { str001 } from './str001-heading-hierarchy-skip.js'
import { str002 } from './str002-no-headings.js'
import { str003 } from './str003-section-too-long.js'
import { str004 } from './str004-table-as-image.js'
import { str005 } from './str005-image-missing-alt.js'
import { str006 } from './str006-code-block-no-language.js'
import { str007 } from './str007-vague-link-text.js'
import { str008 } from './str008-layout-table.js'
import { str009 } from './str009-table-no-header.js'
import { str010 } from './str010-deep-nesting.js'
import { str011 } from './str011-attachment-only.js'
import { str012 } from './str012-unrendered-macro.js'

export const STRUCTURE_RULES: Rule[] = [
  str001,
  str002,
  str003,
  str004,
  str005,
  str006,
  str007,
  str008,
  str009,
  str010,
  str011,
  str012,
]

export { isMeaningfulAlt } from './str005-image-missing-alt.js'
