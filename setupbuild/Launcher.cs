using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace CboinnDriverScanner
{
    static class Program
    {
        static bool IsProtectedInstall(string directory)
        {
            string full = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string[] roots = {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
            };

            foreach (string root in roots)
            {
                if (String.IsNullOrWhiteSpace(root)) continue;
                string rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        [STAThread]
        static int Main()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            string ps1 = Path.Combine(dir, "DriverScanner.ps1");
            string worker = Path.Combine(dir, "engine", "Worker.ps1");
            string xaml = Path.Combine(dir, "ui.xaml");

            try
            {
                if (!IsProtectedInstall(dir))
                {
                    MessageBox.Show(
                        "For security, run Setup.exe first and start the app from the Start menu.",
                        "Cboinn Driver Scanner",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                    return 2;
                }

                foreach (string required in new[] { ps1, worker, xaml })
                {
                    if (!File.Exists(required)) throw new FileNotFoundException("Required application file is missing.", required);
                }

                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File \"" + ps1 + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = dir
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "CboinnDriverScanner-error.txt"), ex.ToString()); } catch { }
                MessageBox.Show(ex.Message, "Cboinn Driver Scanner", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            return 0;
        }
    }
}
