// CST-DEV self-hosted Windows DPAPI custody primitive: SOURCE + TEST ONLY.
// No private-key generation, enrollment, unseal CLI, signer service,
// credential, database access or dispatch. No Google/cloud dependency.
// DPAPI CurrentUser is NOT TPM non-exportable hardware key protection.
using System;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

namespace CstDevOneJob
{
  internal static class DpapiUserCustody
  {
    const string Domain = "CST_DEV_ONEJOB_DPAPI_CURRENT_USER_V1";
    const string Project = "xssrfshdrtdfupgqwfdw";
    static readonly string[] Roles =
      {"coding","infrastructure","security","qa","reviewer"};

    static byte[] Entropy(string role, string signerSid, string sourceSha)
    {
      if (Array.IndexOf(Roles,role)<0 ||
          String.IsNullOrEmpty(signerSid) ||
          !Regex.IsMatch(signerSid,@"^S-1-\d+(?:-\d+)+$") ||
          String.IsNullOrEmpty(sourceSha) ||
          !Regex.IsMatch(sourceSha,@"^[a-f0-9]{40}$"))
        throw new ArgumentException("INVALID_CST_DEV_KEY_SCOPE");
      byte[] encoded=Encoding.UTF8.GetBytes(
        Domain+"|"+Project+"|1|"+role+"|"+signerSid+"|"+sourceSha);
      try
      {
        using (var hash=SHA256.Create()) return hash.ComputeHash(encoded);
      }
      finally { Array.Clear(encoded,0,encoded.Length); }
    }

    // Both methods are intentionally INTERNAL and not CLI-addressable.
    // An independently approved service will still require strict caller
    // SID/role, signed release, protected filesystem ACL and durable nonce
    // checks BEFORE any future key-unsealing operation is exposed.
    internal static byte[] Seal(byte[] material,string role,string sid,string sha)
    {
      if(material==null||material.Length<1||material.Length>8192)
        throw new ArgumentException("MATERIAL_SIZE_INVALID");
      byte[] entropy=Entropy(role,sid,sha);
      try
      {
        return ProtectedData.Protect(material,entropy,
          DataProtectionScope.CurrentUser);
      }
      finally { Array.Clear(entropy,0,entropy.Length); }
    }
    internal static byte[] Open(byte[] encrypted,string role,string sid,string sha)
    {
      if(encrypted==null||encrypted.Length<16||encrypted.Length>16384)
        throw new ArgumentException("SEALED_BLOB_SIZE_INVALID");
      byte[] entropy=Entropy(role,sid,sha);
      try
      {
        return ProtectedData.Unprotect(encrypted,entropy,
          DataProtectionScope.CurrentUser);
      }
      finally { Array.Clear(entropy,0,entropy.Length); }
    }
    static bool Equal(byte[] a,byte[] b)
    {
      if(a==null||b==null||a.Length!=b.Length) return false;
      int diff=0;
      for(int i=0;i<a.Length;i++) diff|=(a[i]^b[i]);
      return diff==0;
    }
    static bool Denied(Action attempt)
    {
      try {attempt();return false;}
      catch(CryptographicException) {return true;}
      catch(ArgumentException) {return true;}
    }
    static bool SelfTest()
    {
      if(Environment.OSVersion.Platform!=PlatformID.Win32NT)
        throw new Exception("WINDOWS_ONLY");
      string sid=WindowsIdentity.GetCurrent().User.Value;
      string sha=new string('a',40);
      byte[] synthetic=new byte[48],sealedBytes=null,opened=null;
      using(var rng=RandomNumberGenerator.Create())
        rng.GetBytes(synthetic);
      try
      {
        sealedBytes=Seal(synthetic,"coding",sid,sha);
        opened=Open(sealedBytes,"coding",sid,sha);
        bool roundTrip=Equal(synthetic,opened);
        bool wrongRole=Denied(()=>Open(sealedBytes,"reviewer",sid,sha));
        bool wrongSha=Denied(()=>Open(sealedBytes,"coding",sid,new string('b',40)));
        bool wrongSid=Denied(()=>Open(sealedBytes,"coding","S-1-5-18",sha));
        byte[] tampered=(byte[])sealedBytes.Clone();
        tampered[tampered.Length-1]^=0x55;
        bool tamper=Denied(()=>Open(tampered,"coding",sid,sha));
        Array.Clear(tampered,0,tampered.Length);
        bool malformed=Denied(()=>Seal(synthetic,"unregistered",sid,sha));
        bool ok=roundTrip&&wrongRole&&wrongSha&&wrongSid&&tamper&&malformed;
        Console.WriteLine(
          "{\"status\":\""+(ok?"PASS":"FAIL")+"\","+
          "\"scope\":\"WINDOWS_DPAPI_CURRENT_USER_SYNTHETIC_ONLY\","+
          "\"roundTrip\":"+roundTrip.ToString().ToLowerInvariant()+","+
          "\"wrongScopeMetadataDenied\":"+
             (wrongRole&&wrongSha&&wrongSid).ToString().ToLowerInvariant()+","+
          "\"tamperingDenied\":"+tamper.ToString().ToLowerInvariant()+","+
          "\"wrongRoleRejected\":"+malformed.ToString().ToLowerInvariant()+","+
          "\"differentWindowsUserTested\":false,"+
          "\"realSignerKeyCreated\":false,"+
          "\"vaultFileCreated\":false,"+
          "\"privateKeyExported\":false,"+
          "\"signerActivated\":false,"+
          "\"signatureIssued\":false,"+
          "\"releaseDecision\":\"NO_GO\"}");
        return ok;
      }
      finally
      {
        Array.Clear(synthetic,0,synthetic.Length);
        if(sealedBytes!=null) Array.Clear(sealedBytes,0,sealedBytes.Length);
        if(opened!=null) Array.Clear(opened,0,opened.Length);
      }
    }

    public static int Main(string[] args)
    {
      if(args.Length!=1||args[0]!="--synthetic-selftest")
      {
        Console.WriteLine("CST_DEV_DPAPI_OPERATIONAL_COMMANDS_DISABLED");
        return 2;
      }
      try {return SelfTest()?0:3;}
      catch
      {
        // Do not print DPAPI exception details or any material.
        Console.WriteLine("CST_DEV_DPAPI_SELFTEST_DENIED_NO_GO");
        return 4;
      }
    }
  }
}
