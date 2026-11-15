#!/usr/bin/env node
/**
 * Compile the C# embedded in native/windows/pet.ps1 against .NET Framework 4.8
 * reference assemblies. Windows PowerShell 5.1's Add-Type uses that same target,
 * so this catches syntax or API mistakes in the WinForms helper without a Windows
 * machine. Requires the .NET SDK; exits successfully with a notice when it is not
 * installed (the regular test suite does not depend on it).
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(root, 'native/windows/pet.ps1')

function fail(message) {
  console.error(`[check-windows] error: ${message}`)
  process.exit(1)
}

function extractSource(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === "$source = @'")
  const end = lines.findIndex((line, index) => index > start && line.trim() === "'@")
  if (start < 0 || end < 0) fail('could not locate the embedded C# here-string in pet.ps1')
  const source = lines.slice(start + 1, end).join('\n')
  if (!source.includes('public class PetForm')) fail('embedded C# does not declare PetForm')
  return source
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

/**
 * Parse pet.ps1 with the PowerShell engine when it is available. This catches
 * here-string or wrapper mistakes without needing Windows.
 */
function checkPowerShellSyntax() {
  const probe = run('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'])
  if (probe.error || probe.status !== 0) {
    console.log('[check-windows] pwsh not found; skipping the pet.ps1 parse check')
    return
  }
  const result = run('pwsh', ['-NoProfile', '-File', join(root, 'scripts', 'parse-powershell-helper.ps1')])
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    console.error(output)
    fail('native/windows/pet.ps1 is not valid PowerShell')
  }
  console.log('[check-windows] native/windows/pet.ps1 parses as PowerShell')
}

checkPowerShellSyntax()

const probe = run('dotnet', ['--version'])
if (probe.error || probe.status !== 0) {
  console.log('[check-windows] .NET SDK not found; skipping the Windows C# compile check')
  process.exit(0)
}

const directory = mkdtempSync(join(tmpdir(), 'dsh-alk-pet-windows-'))
try {
  writeFileSync(join(directory, 'PetForm.cs'), extractSource(readFileSync(scriptPath, 'utf8')))
  writeFileSync(join(directory, 'PetCheck.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <OutputType>Library</OutputType>
    <LangVersion>5</LangVersion>
    <Nullable>disable</Nullable>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <NoWarn>CS0618;CS0168;CS0219;CS0414</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />
    <Reference Include="System.Web.Extensions" />
    <Reference Include="System.Windows.Forms" />
    <Reference Include="System.Drawing" />
  </ItemGroup>
</Project>
`)
  const build = run('dotnet', ['build', '-v', 'q', '-nologo', directory], {
    cwd: directory,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  })
  const output = [build.stdout, build.stderr].filter(Boolean).join('\n').trim()
  if (build.status !== 0) {
    console.error(output)
    fail('embedded Windows helper C# did not compile against .NET Framework 4.8')
  }
  console.log('[check-windows] embedded Windows helper C# compiles against .NET Framework 4.8')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
