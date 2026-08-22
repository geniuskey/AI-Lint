import type { FileContext } from '@ai-lint/ir'
import { attr, findDescendant, findDescendants, parseFragment, textOf } from '@ai-lint/xml'
import { strFromU8, unzipSync } from 'fflate'

export interface Package {
  names(): string[]
  text(path: string): string | null
}

/** slide10이 slide2보다 뒤에 오도록 숫자를 크기로 비교한다. */
export const compareNatural = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

export function openPackage(bytes: Uint8Array): Package {
  const entries = unzipSync(bytes)
  return {
    names: () => Object.keys(entries),
    text: (path) => {
      const entry = entries[path]
      return entry === undefined ? null : strFromU8(entry)
    },
  }
}

export function parsePart(pkg: Package, path: string): Element | null {
  const xml = pkg.text(path)
  return xml === null ? null : parseFragment(xml)
}

export function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/')
  const dir = slash === -1 ? '' : partPath.slice(0, slash + 1)
  const name = partPath.slice(slash + 1)
  return `${dir}_rels/${name}.rels`
}

/** 관계의 Target은 파트가 있는 폴더 기준의 상대 경로다. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)

  const slash = partPath.lastIndexOf('/')
  const base = slash === -1 ? [] : partPath.slice(0, slash).split('/')
  for (const step of target.split('/')) {
    if (step === '.' || step === '') continue
    if (step === '..') base.pop()
    else base.push(step)
  }
  return base.join('/')
}

export interface Relationship {
  id: string
  type: string
  /** 내부 관계면 패키지 안의 파트 경로, 외부 관계면 원래 주소 그대로 */
  target: string
  external: boolean
}

export function relationships(pkg: Package, partPath: string): Map<string, Relationship> {
  const root = parsePart(pkg, relsPathFor(partPath))
  const map = new Map<string, Relationship>()
  if (root === null) return map

  for (const el of findDescendants(root, 'relationship')) {
    const id = attr(el, 'Id')
    const target = attr(el, 'Target')
    if (id === null || target === null) continue
    const external = attr(el, 'TargetMode') === 'External'
    map.set(id, {
      id,
      type: attr(el, 'Type') ?? '',
      target: external ? target : resolveTarget(partPath, target),
      external,
    })
  }
  return map
}

export interface CoreProperties {
  title?: string
  creator?: string
  modified?: string
}

export function coreProperties(pkg: Package): CoreProperties {
  const root = parsePart(pkg, 'docProps/core.xml')
  if (root === null) return {}

  const read = (tag: string): string | undefined => {
    const el = findDescendant(root, tag)
    const text = el === null ? '' : textOf(el)
    return text === '' ? undefined : text
  }

  const title = read('title')
  const creator = read('creator')
  const modified = read('modified')
  return {
    ...(title === undefined ? {} : { title }),
    ...(creator === undefined ? {} : { creator }),
    ...(modified === undefined ? {} : { modified }),
  }
}

/** 호출자가 준 값이 우선이다. 파일 시스템 쪽이 문서 속성보다 최신인 경우가 많다. */
export function mergeContext(ctx: FileContext, core: CoreProperties): FileContext {
  const modifiedAt = ctx.modifiedAt ?? core.modified
  const author = ctx.author ?? core.creator
  return {
    uri: ctx.uri,
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(author === undefined ? {} : { author }),
  }
}
