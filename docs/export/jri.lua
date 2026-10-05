-- Pandoc filter: applies the Agence JRi document style.
-- 1. Drops the body H1 (the title comes from the YAML metadata).
-- 2. Adds the meta line (reference, version, date, status) under the title.
-- 3. Turns "Decision / Why" blockquotes into a framed box.
-- 4. Keeps a paragraph on the same page as the table, figure or list it introduces.
-- 5. Turns <!-- pagebreak --> (invisible on GitHub) into a page break.

local function str(m) return m and pandoc.utils.stringify(m) or nil end

function Pandoc(doc)
  local blocks = doc.blocks
  if #blocks > 0 and blocks[1].t == "Header" and blocks[1].level == 1 then
    blocks:remove(1)
  end
  local m = doc.meta
  local parts = {}
  if m.reference then table.insert(parts, "Réf. " .. str(m.reference)) end
  if m.version then table.insert(parts, "Version " .. str(m.version)) end
  if m.date then table.insert(parts, str(m.date)) end
  if m.status then table.insert(parts, str(m.status)) end
  if #parts > 0 then
    local meta = pandoc.Div({pandoc.Para({pandoc.Str(table.concat(parts, "  ·  "))})},
      pandoc.Attr("", {}, {{"custom-style", "Meta"}}))
    blocks:insert(1, meta)
  end
  doc.meta.date = nil -- already in the meta line
  doc.blocks = blocks
  return doc
end

function BlockQuote(bq)
  local first = pandoc.utils.stringify(bq.content[1] or "")
  if first:match("^Décision") or first:match("^Decision") then
    local label = pandoc.Div({pandoc.Para({pandoc.Str(first:match("^Decision") and "DECISION" or "DÉCISION")})},
      pandoc.Attr("", {}, {{"custom-style", "Cartouche titre"}}))
    local body = pandoc.Div(bq.content, pandoc.Attr("", {}, {{"custom-style", "Cartouche"}}))
    return {label, body}
  end
end

local introduced = {Table=true, Figure=true, BulletList=true, OrderedList=true}

function Blocks(blocks)
  local out = pandoc.Blocks({})
  for i, b in ipairs(blocks) do
    local nxt = blocks[i + 1]
    if b.t == "RawBlock" and b.format == "html" and b.text:match("^<!%-%-%s*pagebreak%s*%-%->$") then
      out:insert(pandoc.RawBlock("openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'))
    elseif b.t == "Para" and nxt and introduced[nxt.t] then
      out:insert(pandoc.Div({b}, pandoc.Attr("", {}, {{"custom-style", "Body Text Keep"}})))
    else
      out:insert(b)
    end
  end
  return out
end
