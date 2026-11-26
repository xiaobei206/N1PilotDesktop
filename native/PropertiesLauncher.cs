using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class N1PilotPropertiesLauncher
{
    private const uint SHOP_FILEPATH = 0x00000002;
    private const uint GW_OWNER = 4;
    private const int ERROR_TIMEOUT = 1460;
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SHObjectProperties(IntPtr hwnd, uint shopObjectType, string pszObjectName, string pszPropertyPage);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private static string WindowText(IntPtr hWnd)
    {
        StringBuilder value = new StringBuilder(512);
        GetWindowText(hWnd, value, value.Capacity);
        return value.ToString();
    }
    private static string WindowClass(IntPtr hWnd)
    {
        StringBuilder value = new StringBuilder(256);
        GetClassName(hWnd, value, value.Capacity);
        return value.ToString();
    }
    private static IntPtr FindPropertiesWindow(IntPtr owner, string target, uint ownPid)
    {
        string baseName = Path.GetFileName(target) ?? target;
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr ignored)
        {
            if (hWnd == IntPtr.Zero || hWnd == owner || !IsWindow(hWnd) || !IsWindowVisible(hWnd)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            IntPtr windowOwner = GetWindow(hWnd, GW_OWNER);
            bool ownedByAppWindow = owner != IntPtr.Zero && windowOwner == owner;
            bool createdByHelper = pid == ownPid;
            string title = WindowText(hWnd);
            string cls = WindowClass(hWnd);
            bool titleMatches = !String.IsNullOrEmpty(baseName) && title.IndexOf(baseName, StringComparison.OrdinalIgnoreCase) >= 0;
            bool standardDialog = String.Equals(cls, "#32770", StringComparison.Ordinal);
            if ((titleMatches && (ownedByAppWindow || createdByHelper || standardDialog)) || (ownedByAppWindow && standardDialog))
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    [STAThread]
    public static int Main(string[] args)
    {
        if (args == null || args.Length < 2 || String.IsNullOrWhiteSpace(args[1])) return 87;
        long ownerValue;
        if (!Int64.TryParse(args[0], out ownerValue)) ownerValue = 0;
        IntPtr owner = new IntPtr(ownerValue);
        string target = Path.GetFullPath(args[1]);
        if (!File.Exists(target) && !Directory.Exists(target)) return 2;

        bool invoked = SHObjectProperties(owner, SHOP_FILEPATH, target, null);
        if (!invoked)
        {
            int error = Marshal.GetLastWin32Error();
            return error == 0 ? 1 : error;
        }

        // Keep this helper alive until the Shell property sheet is closed. Exiting too early
        // can make the shell-owned property sheet disappear. Electron is not minimized.
        uint ownPid = (uint)Process.GetCurrentProcess().Id;
        IntPtr propertyWindow = IntPtr.Zero;
        Stopwatch startup = Stopwatch.StartNew();
        while (startup.ElapsedMilliseconds < 15000 && propertyWindow == IntPtr.Zero)
        {
            propertyWindow = FindPropertiesWindow(owner, target, ownPid);
            if (propertyWindow == IntPtr.Zero) Thread.Sleep(100);
        }
        if (propertyWindow == IntPtr.Zero) return ERROR_TIMEOUT;
        try { SetForegroundWindow(propertyWindow); } catch { }
        while (IsWindow(propertyWindow)) Thread.Sleep(150);
        return 0;
    }
}
