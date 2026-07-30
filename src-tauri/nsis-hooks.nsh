; Spoor 卸载钩子：删文件前问一句要不要留下本地媒体数据。
;
; 为什么必须问：SpoorData 里是用户 AI 生成的图和上传的原件，数量可能上千、
; 体积可能上 GB，删掉不可恢复。默认卸载会把安装目录整个清掉，连带全没。
;
; 画布笔记不在这里（在 WebView2 的 IndexedDB），文案里已注明，免得用户以为
; 「保留数据」能保住笔记、或以为「全部删除」会连笔记一起删。

!macro NSIS_HOOK_PREUNINSTALL
  ; $INSTDIR = 安装目录，数据根与 Rust 侧 media.rs 的 DATA_DIR_NAME 保持一致
  StrCpy $R0 "$INSTDIR\SpoorData"

  ; 标记文件由应用首次启动时写入。没有它说明这不是 Spoor 的数据目录
  ; （用户改过安装位置、或数据根回退到了 %LOCALAPPDATA%），此时不问也不动。
  IfFileExists "$R0\.spoor-data-root" 0 done

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否保留您的本地数据？$\r$\n$\r$\n数据目录：$\r$\n    $R0$\r$\n$\r$\n选择「否」将永久删除所有 AI 生成的图片、上传的图片/视频/文档，且无法恢复。$\r$\n$\r$\n画布笔记不在此目录内，不受影响。" \
    /SD IDYES IDYES keep IDNO purge

  keep:
    ; 从卸载清单里摘出去：后续的 RMDir /r $INSTDIR 会绕过它
    Rename "$R0" "$LOCALAPPDATA\Spoor\SpoorData-kept"
    MessageBox MB_OK|MB_ICONINFORMATION \
      "数据已保留在：$\r$\n$LOCALAPPDATA\Spoor\SpoorData-kept" /SD IDOK
    Goto done

  purge:
    RMDir /r "$R0"

  done:
!macroend
