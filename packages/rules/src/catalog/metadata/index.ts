import type { Rule } from '../../types.js'
import { meta001 } from './meta001-title-not-descriptive.js'
import { meta002 } from './meta002-missing-summary.js'
import { meta003 } from './meta003-no-labels.js'
import { meta004 } from './meta004-no-owner.js'
import { meta005 } from './meta005-stale-document.js'
import { meta006 } from './meta006-broken-link.js'
import { meta007 } from './meta007-missing-required-section.js'
import { meta008 } from './meta008-draft-marker.js'

export const METADATA_RULES: Rule[] = [meta001, meta002, meta003, meta004, meta005, meta006, meta007, meta008]
