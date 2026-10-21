' Start ConceptAI with no terminal window: the desktop and Start menu shortcuts run this.
' Arguments are passed on to scripts\launcher.mjs (--background, --stop).
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
' 0 = hidden window, False = don't wait.
shell.Run "node scripts\launcher.mjs" & args, 0, False
