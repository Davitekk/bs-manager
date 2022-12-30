import { BS_APP_ID, BS_DEPOT } from "../constants";
import path from "path";
import { BSVersion } from 'shared/bs-version.interface';
import { UtilsService } from "./utils.service";
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import log from "electron-log";
import { InstallationLocationService } from "./installation-location.service";
import { ctrlc } from "ctrlc-windows";
import { BSLocalVersionService } from "./bs-local-version.service";
import isOnline from 'is-online';
import { WindowManagerService } from "./window-manager.service";

export class BSInstallerService{

  private static instance: BSInstallerService;

  private readonly utils: UtilsService;
  private readonly installLocationService: InstallationLocationService;
  private readonly localVersionService: BSLocalVersionService;
  private readonly windows: WindowManagerService;

  private downloadProcess: ChildProcessWithoutNullStreams;

  private constructor(){
    this.utils =  UtilsService.getInstance();
    this.installLocationService = InstallationLocationService.getInstance();
    this.localVersionService = BSLocalVersionService.getInstance();
    this.windows = WindowManagerService.getInstance();

    this.windows.getWindows("index.html")?.on("close", () => {
        this.killDownloadProcess();
    });
  }

  public static getInstance(){
    if(!BSInstallerService.instance){ BSInstallerService.instance = new BSInstallerService(); }
    return BSInstallerService.instance;
  }

    private getDepotDownloaderExePath(): string{
        return path.join(this.utils.getAssetsScriptsPath(), 'depot-downloader', 'DepotDownloader.exe');
    }

    private removeSpecialSchar(txt: string): string{ return txt.replaceAll(/\[|\]/g, ""); }

    private sendDownloadEvent(event: DownloadEventType, data?: string|number, success = true): void{
        if(typeof data === "string"){ data = this.removeSpecialSchar(data); }
        this.utils.ipcSend(`bs-download.${event}`, { success, data });
    }

  public sendInputProcess(input: string){
    if(this.downloadProcess.stdin.writable){
      this.downloadProcess.stdin.write(`${input}\n`);
    }
  }

   public killDownloadProcess(): Promise<boolean>{
      return new Promise(resolve => {
         if(this.downloadProcess?.killed && !this.downloadProcess?.pid){ return resolve(false); }

         this.downloadProcess.once('exit', () => resolve(true));

         ctrlc(this.downloadProcess.pid);
         setTimeout(() => resolve(false), 3000);
      });
   }

    public async isDotNet6Installed(): Promise<boolean>{
        try{
            const process = spawnSync(this.getDepotDownloaderExePath());
            const out = process.output.toString();
            if(out.includes(".NET runtime can be found at")){ return false; }
            return true;
        }
        catch(e){
            return false;
        }
    }

  public async downloadBsVersion(downloadInfos: DownloadInfo): Promise<DownloadEvent>{

    if(this.downloadProcess && this.downloadProcess.connected){ throw "AlreadyDownloading"; }
    const {bsVersion} = downloadInfos;
    if(!bsVersion){ return {type: "[Error]"}; }
    if(!(await isOnline({timeout: 1500}))){ throw "no-internet"; }

    this.utils.createFolderIfNotExist(this.installLocationService.versionsDirectory);
    this.downloadProcess = spawn(
      this.getDepotDownloaderExePath(),
      [
        `-app ${BS_APP_ID}`,
        `-depot ${BS_DEPOT}`,
        `-manifest ${bsVersion.BSManifest}`,
        `-username ${downloadInfos.username}`,
        `-dir \"${this.localVersionService.getVersionFolder(bsVersion)}\"`,
        (downloadInfos.stay || !downloadInfos.password) && "-remember-password"
      ],
      {shell: true, cwd: this.installLocationService.versionsDirectory}
    );

    return new Promise((resolve, reject) => {

      this.downloadProcess.stdout.on('data', data => {
        const matched = (data.toString() as string).match(/(?:\[(.*?)\])\|(?:\[(.*?)\]\|)?(.*?)(?=$|\[)/gm) ?? [];
        matched.forEach(match => {
          const out = match.split("|");

          if(out[0] !== "[Progress]" && out[0] !== "[Validated]"){ log.info(data.toString()); }
  
          if(out[0] === "[Password]" as DownloadEventType && downloadInfos.password){
            this.sendInputProcess(downloadInfos.password);
          }
          else if(out[0] === "[Password]" as DownloadEventType){
            this.killDownloadProcess();
            resolve({type: "[Password]", data: bsVersion});
          }
          else if(out[0] === "[2FA]" as DownloadEventType || out[0] === "[Guard]" as DownloadEventType){
            this.sendDownloadEvent("[2FA]")
          }
          else if(out[0] === "[Progress]" as DownloadEventType || (out[0] === "[Validated]" as DownloadEventType && parseFloat(out[1]) < 100)){ 
            this.sendDownloadEvent("[Progress]", parseFloat(out[1].replaceAll(",", ".")));
          }
          else if(out[0] === "[Finished]" as DownloadEventType || (out[0] === "[Validated]" as DownloadEventType && parseFloat(out[1]) === 100)){
            resolve({type: "[Finished]"});
            this.killDownloadProcess();
          }
          else if(out[0] === "[SteamID]" as DownloadEventType){
            this.sendDownloadEvent("[SteamID]", out[1]);
          }
          else if(out[0] === "[Warning]" as DownloadEventType){
            this.sendDownloadEvent("[Warning]", out[1]);
          }
          else if(out[0] === "[Error]" as DownloadEventType){
            reject(this.removeSpecialSchar(out[1]));
            this.killDownloadProcess();
            log.error("Download Event, Error", data.toString());
          }
        });
        
      })
  
      this.downloadProcess.stdout.on('error', (err) => {
        log.error("BS-DOWNLOAD ERROR", err.toString());
        this.killDownloadProcess();
        reject();
      });
      this.downloadProcess.stderr.on('data', (err) => { 
        log.error("BS-DOWNLOAD ERROR", err.toString());
        this.killDownloadProcess();
        reject();
      });
      this.downloadProcess.stderr.on('error', (err) => { 
        log.error("BS-DOWNLOAD ERROR", err.toString());
        this.killDownloadProcess();
        reject();
      });

      this.downloadProcess.on('close', () => reject());
    })
  }

}




export interface DownloadInfo {
  bsVersion: BSVersion,
  username: string,
  password?: string,
  stay?: boolean
}

export interface DownloadEvent{
  type: DownloadEventType,
  data?: unknown,
}

export type DownloadEventType = "[Password]" | "[Guard]" | "[2FA]" | "[Progress]" | "[Validated]" | "[Finished]" | "[AlreadyDownloading]" | "[Error]" | "[Warning]" | "[SteamID]" | "[Exit]" | "[NoInternet]";
