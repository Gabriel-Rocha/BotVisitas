import psutil
import subprocess
import schedule

def kill_tuxler_processes():
    tuxler_process_names = [
        "ExtensionHelperAppManager.exe",
        "ExtensionHelperApp.exe"
    ]

    for process in psutil.process_iter(['pid', 'name']):
        for tuxler_process_name in tuxler_process_names:
            if tuxler_process_name.lower() in process.info['name'].lower():
                try:
                    # Obtém informações detalhadas sobre o processo
                    process_details = psutil.Process(process.info['pid'])
                    print(f'Terminating process {process.info["pid"]} - {process_details.name()}')
                    process_details.terminate()
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    # Ignora exceções específicas que podem ocorrer durante a obtenção de informações do processo
                    pass

    # Substitua pelo caminho correto do seu arquivo
    arquivo_a_executar = r"C:\Program Files (x86)\TuxlerChromeExtensionHelperApp\ExtensionHelperAppManager.exe"
    
    print(f'Executando o arquivo: {arquivo_a_executar}')
    subprocess.Popen([arquivo_a_executar])

# Executa o script uma vez
kill_tuxler_processes()
