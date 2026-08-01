import os, shutil, subprocess

subprocess.Popen(
	[shutil.which("electron"), os.path.dirname(os.path.realpath(__file__))],
	creationflags=subprocess.CREATE_NO_WINDOW,
)
