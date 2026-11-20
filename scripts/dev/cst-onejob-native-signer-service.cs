// CST-DEV one-job DELL native Windows Service host.
// No key, signer, credential, event dispatch or production access.
// This wrapper starts only an independently approved, protected host worker.
// Default: no keys or approved host => fail CLOSED.
using System;
using System.IO;
using System.Diagnostics;
using System.Security.Principal;
using System.ServiceProcess;
using System.Collections.Generic;

namespace CstDevOneJob {
  public sealed class SignerHostService : ServiceBase {
    private readonly string role;
    private Process worker;
    private static readonly Dictionary<string,string> Account =
      new Dictionary<string,string>(StringComparer.Ordinal) {
        {"coding","cstdev_sign_coding"},
        {"infrastructure","cstdev_sign_infra"},
        {"security","cstdev_sign_security"},
        {"qa","cstdev_sign_qa"},
        {"reviewer","cstdev_sign_reviewer"}
      };
    public SignerHostService(string currentRole) {
      role=currentRole;
      ServiceName="CSTDEVOneJobSigner_"+role;
      CanStop=true;
      CanPauseAndContinue=false;
      AutoLog=false;
    }
    public static bool RecognizesRole(string r) {
      return r!=null&&Account.ContainsKey(r);
    }
    private void VerifyProcessBoundary() {
      if(!String.Equals(Environment.MachineName,"DELL",
        StringComparison.OrdinalIgnoreCase)) throw new Exception("WRONG_HOST");
      if(!RecognizesRole(role)) throw new Exception("UNKNOWN_SIGNER_ROLE");
      var expected = (SecurityIdentifier)new NTAccount(
        Environment.MachineName,Account[role]).Translate(typeof(SecurityIdentifier));
      using(var token = WindowsIdentity.GetCurrent()) {
        if(token.User==null||token.User.Value!=expected.Value)
          throw new Exception("SIGNER_TOKEN_NOT_SCOPED_TO_EXISTING_ACCOUNT");
        if(new WindowsPrincipal(token).IsInRole(WindowsBuiltInRole.Administrator))
          throw new Exception("ADMIN_SIGNER_FORBIDDEN");
      }
    }
    protected override void OnStart(string[] args) {
      VerifyProcessBoundary();
      // No direct signing in this wrapper. A distinct, reviewed Ed25519
      // provider has to be installed by its independent custodian.
      const string installDir=@"C:\Program Files\CSTDEV\OneJobSigner";
      const string nodeExe=@"C:\Program Files\nodejs\node.exe";
      string approvedWorker=Path.Combine(installDir,"cstdev-protected-signer-host.mjs");
      string protectedRoot=Path.Combine(
        @"C:\ProgramData\CSTDEV\OneJob\custody",role);
      string pinnedTrust=Path.Combine(protectedRoot,"qa-public-root.json");
      string release=Path.Combine(protectedRoot,"signed-service-release.json");
      if(!File.Exists(approvedWorker)||!File.Exists(nodeExe)||
         !File.Exists(pinnedTrust)||!File.Exists(release))
        throw new Exception("INDEPENDENT_SIGNER_CUSTODY_NOT_PROVISIONED");
      // Fixed paths only; the protected worker MUST itself verify its pinned
      // source hash, OS-protected trust, signed release and durable replay
      // authority before binding any authenticated named pipe.
      var psi=new ProcessStartInfo {
        FileName=nodeExe,
        Arguments="\""+approvedWorker+"\" --service-role "+role,
        WorkingDirectory=installDir,
        UseShellExecute=false,
        CreateNoWindow=true,
        RedirectStandardInput=false,
        RedirectStandardOutput=false,
        RedirectStandardError=false
      };
      worker=Process.Start(psi);
      if(worker==null||worker.HasExited)
        throw new Exception("INDEPENDENT_SIGNER_HOST_NOT_STARTED");
    }
    protected override void OnStop() {
      if(worker!=null) {
        try {if(!worker.HasExited)worker.Kill();}catch {}
        worker.Dispose();worker=null;
      }
    }
    public static int Main(string[] args) {
      if(args.Length==1&&args[0]=="--preflight") {
        bool correctHost=String.Equals(Environment.MachineName,"DELL",
          StringComparison.OrdinalIgnoreCase);
        bool noCustody=!Directory.Exists(
          @"C:\ProgramData\CSTDEV\OneJob\custody");
        Console.WriteLine("SERVICE_BINARY_PREFLIGHT="+(correctHost?"PASS":"WRONG_HOST"));
        Console.WriteLine("FIVE_ROLE_NAMES="+Account.Count);
        Console.WriteLine("CUSTODY_NOT_PROVISIONED="+noCustody);
        Console.WriteLine("SIGNATURE_ISSUED=FALSE");
        Console.WriteLine("RELEASE_DECISION=NO_GO");
        return correctHost?0:2;
      }
      if(args.Length!=2||args[0]!="--service"||!RecognizesRole(args[1]))
        return 2;
      ServiceBase.Run(new SignerHostService(args[1]));
      return 0;
    }
  }
}
