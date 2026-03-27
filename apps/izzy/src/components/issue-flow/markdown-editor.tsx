"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from "lexical";
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_CHECK_LIST_COMMAND } from "@lexical/list";

const theme = {
  paragraph: "editor-paragraph",
  heading: {
    h1: "editor-h1",
    h2: "editor-h2",
    h3: "editor-h3",
  },
  text: {
    bold: "editor-bold",
    italic: "editor-italic",
    code: "editor-inline-code",
  },
  list: {
    ul: "editor-ul",
    ol: "editor-ol",
    listitem: "editor-li",
    listitemChecked: "editor-li-checked",
    listitemUnchecked: "editor-li-unchecked",
  },
  quote: "editor-quote",
  code: "editor-code-block",
  link: "editor-link",
};

function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = React.useState(false);
  const [isItalic, setIsItalic] = React.useState(false);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setIsBold(selection.hasFormat("bold"));
          setIsItalic(selection.hasFormat("italic"));
        }
      });
    });
  }, [editor]);

  return (
    <div className="editor-toolbar">
      <button
        type="button"
        className="toolbar-btn"
        data-active={isBold}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className="toolbar-btn"
        data-active={isItalic}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        title="Italic"
      >
        <em>I</em>
      </button>
      <span className="toolbar-divider" />
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
        title="Bullet list"
      >
        &bull;
      </button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)}
        title="Checklist"
      >
        &#9744;
      </button>
    </div>
  );
}

function SyncPlugin({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const prevValue = useRef<string | null>(null);

  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      editor.update(
        () => {
          $convertFromMarkdownString(value, TRANSFORMERS);
        },
        { tag: "external" },
      );
    }
  }, [editor, value]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has("external")) return;
      editorState.read(() => {
        const md = $convertToMarkdownString(TRANSFORMERS);
        prevValue.current = md;
        onChange(md);
      });
    });
  }, [editor, onChange]);

  return null;
}

export function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const initialConfig = useMemo(
    () => ({
      namespace: "IzzyEditor",
      theme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode],
      onError: (error: Error) => console.error("Lexical error:", error),
    }),
    [],
  );

  return (
    <div className="markdown-editor">
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin />
        <div className="editor-container">
          <RichTextPlugin
            contentEditable={<ContentEditable className="editor-content" />}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <SyncPlugin value={value} onChange={onChange} />
      </LexicalComposer>
    </div>
  );
}
