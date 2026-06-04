using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace CboinnSetup
{
    static class Program
    {
        const string AppName = "Cboinn Driver Scanner";
        const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CboinnDriverScanner";

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);

        static string InstallDirectory
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), AppName); }
        }

        static string StartMenuShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), AppName + ".lnk"); }
        }

        static string DesktopShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), AppName + ".lnk"); }
        }

        static string HashFile(string path)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
            {
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        static void CopyPayload(string sourceRoot, string relativePath, string destination)
        {
            string source = Path.Combine(sourceRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(source)) throw new FileNotFoundException("Required setup file is missing.", source);
            string expected;
            if (!PayloadHashes.Files.TryGetValue(relativePath.Replace('\\', '/'), out expected))
            {
                throw new InvalidDataException("Payload file is not present in the embedded manifest: " + relativePath);
            }
            string actual = HashFile(source);
            if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Payload integrity check failed: " + relativePath);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            File.Copy(source, destination, true);
        }

        static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (string file in Directory.GetFiles(source))
            {
                File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
            }
            foreach (string directory in Directory.GetDirectories(source))
            {
                CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
            }
        }

        static void Shortcut(string shortcutPath, string target, string icon, string workingDirectory)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icon + ",0" });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { AppName });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        static void DeleteLegacyShortcuts()
        {
            string userStart = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
            string userDesktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
            foreach (string path in new[] { userStart, userDesktop })
            {
                try { if (File.Exists(path)) File.Delete(path); } catch { }
            }
        }

        static void MigrateLegacyInstall()
        {
            string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
            if (!Directory.Exists(legacy)) return;

            string legacyBackups = Path.Combine(legacy, "DriverBackups");
            if (Directory.Exists(legacyBackups))
            {
                string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                string destination = Path.Combine(documents, "Cboinn Driver Backups", "Migrated-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                CopyDirectory(legacyBackups, destination);
            }

            try { Directory.Delete(legacy, true); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(RegistryPath, false); } catch { }
            DeleteLegacyShortcuts();
        }

        static string VersionText()
        {
            Version version = Assembly.GetExecutingAssembly().GetName().Version;
            return version.Major + "." + version.Minor + "." + version.Build;
        }

        static void RegisterUninstall(string directory)
        {
            string executable = Path.Combine(directory, "CboinnDriverScanner.exe");
            string uninstaller = Path.Combine(directory, "Uninstall.exe");
            using (RegistryKey key = Registry.LocalMachine.CreateSubKey(RegistryPath))
            {
                key.SetValue("DisplayName", AppName);
                key.SetValue("DisplayVersion", VersionText());
                key.SetValue("Publisher", "CBOINN");
                key.SetValue("DisplayIcon", executable);
                key.SetValue("InstallLocation", directory);
                key.SetValue("UninstallString", "\"" + uninstaller + "\" /uninstall");
                key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /uninstall /silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static void Install(bool silent)
        {
            string source = AppDomain.CurrentDomain.BaseDirectory;
            string directory = InstallDirectory;
            MigrateLegacyInstall();

            Directory.CreateDirectory(directory);
            Directory.CreateDirectory(Path.Combine(directory, "engine"));

            CopyPayload(source, "DriverScanner.ps1", Path.Combine(directory, "DriverScanner.ps1"));
            CopyPayload(source, "ui.xaml", Path.Combine(directory, "ui.xaml"));
            CopyPayload(source, "engine/Worker.ps1", Path.Combine(directory, "engine", "Worker.ps1"));
            CopyPayload(source, "icon.ico", Path.Combine(directory, "icon.ico"));
            CopyPayload(source, "logo.png", Path.Combine(directory, "logo.png"));
            CopyPayload(source, "CboinnDriverScanner.exe", Path.Combine(directory, "CboinnDriverScanner.exe"));
            CopyPayload(source, "README.md", Path.Combine(directory, "README.md"));
            CopyPayload(source, "LICENSE", Path.Combine(directory, "LICENSE"));
            CopyPayload(source, "version.json", Path.Combine(directory, "version.json"));
            File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(directory, "Uninstall.exe"), true);
            File.WriteAllText(Path.Combine(directory, "install.id"), Guid.NewGuid().ToString("N"));

            string executable = Path.Combine(directory, "CboinnDriverScanner.exe");
            string icon = Path.Combine(directory, "icon.ico");
            Shortcut(StartMenuShortcut, executable, icon, directory);
            Shortcut(DesktopShortcut, executable, icon, directory);
            RegisterUninstall(directory);

            if (!silent)
            {
                MessageBox.Show(
                    AppName + " " + VersionText() + " installed.\n\nStart menu and desktop shortcuts were created.\nLocation: " + directory,
                    "Installation complete",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }

        static bool IsExpectedInstallDirectory(string path)
        {
            string expected = Path.GetFullPath(InstallDirectory).TrimEnd(Path.DirectorySeparatorChar);
            string actual = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            return String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase);
        }

        static void RemoveRegistrationAndShortcuts()
        {
            foreach (string path in new[] { StartMenuShortcut, DesktopShortcut })
            {
                try { if (File.Exists(path)) File.Delete(path); } catch { }
            }
            DeleteLegacyShortcuts();
            try { Registry.LocalMachine.DeleteSubKeyTree(RegistryPath, false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(RegistryPath, false); } catch { }
        }

        static bool InstallIdMatches(string directory, string expectedInstallId)
        {
            try
            {
                string path = Path.Combine(directory, "install.id");
                return File.Exists(path) && String.Equals(File.ReadAllText(path).Trim(), expectedInstallId, StringComparison.Ordinal);
            }
            catch { return false; }
        }

        static int CleanupUninstall(string directory, int parentProcessId, string installId, bool silent)
        {
            if (!IsExpectedInstallDirectory(directory)) return 3;
            try
            {
                Process parent = Process.GetProcessById(parentProcessId);
                parent.WaitForExit(15000);
            }
            catch { }

            if (!InstallIdMatches(directory, installId)) return 0;
            RemoveRegistrationAndShortcuts();
            Exception lastError = null;
            for (int attempt = 0; attempt < 30; attempt++)
            {
                try
                {
                    if (!InstallIdMatches(directory, installId)) return 0;
                    if (Directory.Exists(directory)) Directory.Delete(directory, true);
                    lastError = null;
                    break;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    Thread.Sleep(1000);
                }
            }

            MoveFileEx(Assembly.GetExecutingAssembly().Location, null, 4);
            if (lastError != null)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "CboinnDriverScanner-uninstall-error.txt"), lastError.ToString()); } catch { }
                if (!silent) MessageBox.Show(lastError.Message, "Uninstall error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            if (!silent) MessageBox.Show(AppName + " was removed. Driver backups and HTML reports were preserved.", "Uninstall complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        static int BeginUninstall(bool silent)
        {
            if (!silent)
            {
                DialogResult answer = MessageBox.Show(
                    "Remove " + AppName + "?\n\nDriver backups and HTML reports will be preserved.",
                    "Uninstall",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (answer != DialogResult.Yes) return 0;
            }

            string installIdPath = Path.Combine(InstallDirectory, "install.id");
            string installId = File.Exists(installIdPath) ? File.ReadAllText(installIdPath).Trim() : "";
            if (String.IsNullOrWhiteSpace(installId)) throw new InvalidDataException("Install identity is missing.");
            string temporary = Path.Combine(Path.GetTempPath(), "CboinnDriverScanner-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(Assembly.GetExecutingAssembly().Location, temporary, true);
            var start = new ProcessStartInfo
            {
                FileName = temporary,
                Arguments = "/uninstall-cleanup \"" + InstallDirectory + "\" " + Process.GetCurrentProcess().Id + " " + installId + (silent ? " /silent" : ""),
                UseShellExecute = true
            };
            Process.Start(start);
            return 0;
        }

        [STAThread]
        static int Main(string[] args)
        {
            bool silent = Array.Exists(args, delegate(string arg) { return String.Equals(arg, "/silent", StringComparison.OrdinalIgnoreCase); });
            try
            {
                if (args.Length > 0 && String.Equals(args[0], "/uninstall", StringComparison.OrdinalIgnoreCase))
                {
                    return BeginUninstall(silent);
                }
                if (args.Length >= 4 && String.Equals(args[0], "/uninstall-cleanup", StringComparison.OrdinalIgnoreCase))
                {
                    int parentId;
                    if (!Int32.TryParse(args[2], out parentId)) return 4;
                    return CleanupUninstall(args[1], parentId, args[3], silent);
                }

                Install(silent);
                return 0;
            }
            catch (Exception ex)
            {
                if (!silent) MessageBox.Show("Setup error: " + ex.Message, "Cboinn Driver Scanner", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
