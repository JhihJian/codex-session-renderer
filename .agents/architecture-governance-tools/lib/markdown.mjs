import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

export function parseMarkdown(source) {
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

export function visitMarkdown(node, visitor) {
  visitor(node)
  if (!('children' in node)) return
  for (const child of node.children) visitMarkdown(child, visitor)
}

function nodeText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image') return node.alt ?? ''
  if (!('children' in node)) return ''
  return node.children.map(nodeText).join('')
}

export function githubSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replaceAll(' ', '-')
}

export function documentAnchors(source) {
  const anchors = new Set()
  const occurrences = new Map()
  visitMarkdown(parseMarkdown(source), (node) => {
    if (node.type === 'heading') {
      const base = githubSlug(nodeText(node))
      let slug = base
      let suffix = occurrences.get(base) ?? 0
      while (anchors.has(slug)) {
        suffix += 1
        slug = `${base}-${suffix}`
      }
      occurrences.set(base, suffix)
      anchors.add(slug)
      return
    }
    if (node.type !== 'html') return
    const html = node.value.replace(/<!--[\s\S]*?-->/g, '')
    for (const match of html.matchAll(/<a\s+[^>]*\bid=["']([^"']+)["'][^>]*>/gi)) {
      if (match[1] !== undefined) anchors.add(match[1])
    }
  })
  return anchors
}

export function markdownLinks(source) {
  const links = []
  visitMarkdown(parseMarkdown(source), (node) => {
    if (!['link', 'image', 'definition'].includes(node.type)) return
    links.push({
      url: node.url,
      line: node.position?.start.line ?? 0,
    })
  })
  return links
}

export function anchorsFromFile(path) {
  return documentAnchors(readFileSync(path, 'utf8'))
}
