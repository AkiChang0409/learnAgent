import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Columns3, Highlighter, List, ListOrdered, Palette, Redo2, RemoveFormatting,
  Rows3, Table2, Trash2, Undo2
} from 'lucide-react';
import type { RichTextDocument } from '../types';
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  richTextToPlainText,
  sanitizeRichTextDocument
} from '../services/rich-text';

interface RichTextEditorProps {
  value?: RichTextDocument;
  fallbackText: string;
  allowTables?: boolean;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: RichTextDocument, plainText: string) => void;
}

function ToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  children
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rich-toolbar-button ${active ? 'active' : ''}`}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  fallbackText,
  allowTables = true,
  placeholder,
  ariaLabel,
  onChange
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const safeValue = useMemo(
    () => sanitizeRichTextDocument(value, fallbackText, allowTables),
    [value, fallbackText, allowTables]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder }),
      ...(allowTables ? [
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell
      ] : [])
    ],
    content: safeValue,
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true'
      }
    },
    onUpdate: ({ editor: nextEditor }) => {
      const rich = sanitizeRichTextDocument(nextEditor.getJSON(), '', allowTables);
      onChangeRef.current(rich, richTextToPlainText(rich));
    }
  }, [allowTables, placeholder, ariaLabel]);

  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(safeValue);
    if (current !== next) editor.commands.setContent(safeValue, { emitUpdate: false });
  }, [editor, safeValue]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => currentEditor ? ({
      bold: currentEditor.isActive('bold'),
      bulletList: currentEditor.isActive('bulletList'),
      orderedList: currentEditor.isActive('orderedList'),
      inTable: currentEditor.isActive('table'),
      color: String(currentEditor.getAttributes('textStyle').color || ''),
      highlight: String(currentEditor.getAttributes('highlight').color || ''),
      canUndo: currentEditor.can().undo(),
      canRedo: currentEditor.can().redo()
    }) : ({
      bold: false, bulletList: false, orderedList: false, inTable: false,
      color: '', highlight: '', canUndo: false, canRedo: false
    })
  });

  if (!editor) return <div className="rich-editor-loading" aria-label={ariaLabel}>{fallbackText}</div>;

  const currentColor = toolbarState?.color || '';
  const currentHighlight = toolbarState?.highlight || '';
  const inTable = allowTables && Boolean(toolbarState?.inTable);

  return (
    <div className={`rich-editor ${allowTables ? 'full' : 'summary'}`}>
      <div className="rich-toolbar" role="toolbar" aria-label={`${ariaLabel}格式工具栏`}>
        <ToolbarButton label="撤销" disabled={!toolbarState?.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton label="重做" disabled={!toolbarState?.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </ToolbarButton>
        <span className="rich-toolbar-separator" />
        <ToolbarButton label="加粗" active={toolbarState?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton label="无序列表" active={toolbarState?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton label="有序列表" active={toolbarState?.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </ToolbarButton>
        <label className="rich-toolbar-select" title="文字颜色">
          <Palette size={14} />
          <select
            aria-label="文字颜色"
            value={currentColor}
            onChange={(event) => {
              const color = event.target.value;
              if (color) editor.chain().focus().setColor(color).run();
              else editor.chain().focus().unsetColor().run();
            }}
          >
            <option value="">默认文字</option>
            <option value={TEXT_COLORS.accent}>强调</option>
            <option value={TEXT_COLORS.success}>成功</option>
            <option value={TEXT_COLORS.warning}>警告</option>
            <option value={TEXT_COLORS.danger}>危险</option>
          </select>
        </label>
        <label className="rich-toolbar-select" title="高亮颜色">
          <Highlighter size={14} />
          <select
            aria-label="高亮颜色"
            value={currentHighlight}
            onChange={(event) => {
              const color = event.target.value;
              if (color) editor.chain().focus().setHighlight({ color }).run();
              else editor.chain().focus().unsetHighlight().run();
            }}
          >
            <option value="">无高亮</option>
            <option value={HIGHLIGHT_COLORS.yellow}>黄色</option>
            <option value={HIGHLIGHT_COLORS.green}>绿色</option>
            <option value={HIGHLIGHT_COLORS.blue}>蓝色</option>
            <option value={HIGHLIGHT_COLORS.red}>红色</option>
          </select>
        </label>
        <ToolbarButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={15} />
        </ToolbarButton>
        {allowTables && (
          <>
            <span className="rich-toolbar-separator" />
            {!inTable ? (
              <ToolbarButton label="插入 3×3 表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                <Table2 size={15} />
              </ToolbarButton>
            ) : (
              <>
                <ToolbarButton label="添加行" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 size={15} /><span>+</span></ToolbarButton>
                <ToolbarButton label="删除行" onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 size={15} /><span>−</span></ToolbarButton>
                <ToolbarButton label="添加列" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 size={15} /><span>+</span></ToolbarButton>
                <ToolbarButton label="删除列" onClick={() => editor.chain().focus().deleteColumn().run()}><Columns3 size={15} /><span>−</span></ToolbarButton>
                <ToolbarButton label="切换表头" onClick={() => editor.chain().focus().toggleHeaderRow().run()}><Table2 size={15} /></ToolbarButton>
                <ToolbarButton label="删除表格" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 size={15} /></ToolbarButton>
              </>
            )}
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
