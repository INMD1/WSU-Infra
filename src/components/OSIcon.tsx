/**
 * OS 아이콘 컴포넌트
 * 이미지 이름 기반으로 OS 자동 감지 및 아이콘 표시
 */

interface OSIconProps {
  imageName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const OS_ICONS: Record<string, { svg: string; label: string }> = {
  // Windows
  windows: {
    label: 'Windows',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" fill="none">
      <path d="M0 12.8L40.7 0v42.7H0V12.8zM41.8 0L88 11.5v31.2H41.8V0zM0 44.8h40.7v42.7L0 74.5V44.8zM41.8 44.8H88v31.7L41.8 88V44.8z" fill="#00A4EF"/>
    </svg>`
  },
  'windows-11': {
    label: 'Windows 11',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" fill="none">
      <path d="M0 12.8L40.7 0v42.7H0V12.8zM41.8 0L88 11.5v31.2H41.8V0zM0 44.8h40.7v42.7L0 74.5V44.8zM41.8 44.8H88v31.7L41.8 88V44.8z" fill="#0078D4"/>
    </svg>`
  },
  'windows-10': {
    label: 'Windows 10',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" fill="none">
      <path d="M0 12.8L40.7 0v42.7H0V12.8zM41.8 0L88 11.5v31.2H41.8V0zM0 44.8h40.7v42.7L0 74.5V44.8zM41.8 44.8H88v31.7L41.8 88V44.8z" fill="#00A4EF"/>
    </svg>`
  },
  'windows-server': {
    label: 'Windows Server',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" fill="none">
      <path d="M0 12.8L40.7 0v42.7H0V12.8zM41.8 0L88 11.5v31.2H41.8V0zM0 44.8h40.7v42.7L0 74.5V44.8zM41.8 44.8H88v31.7L41.8 88V44.8z" fill="#4B6BB9"/>
    </svg>`
  },

  // Linux Distributions
  ubuntu: {
    label: 'Ubuntu',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#E95420"/>
      <circle cx="50" cy="50" r="35" fill="#FFF"/>
      <path d="M50 15A35 35 0 0 0 15 50H50V15ZM50 85A35 35 0 0 0 85 50H50V85ZM15 50A35 35 0 0 0 50 85V50H15ZM85 50A35 35 0 0 0 50 15V50H85Z" fill="#E95420"/>
    </svg>`
  },
  debian: {
    label: 'Debian',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#A81D33"/>
      <path d="M50 20C33.4 20 20 33.4 20 50s13.4 30 30 30 30-13.4 30-30-13.4-30-30-30zm0 50c-11 0-20-9-20-20s9-20 20-20 20 9 20 20-9 20-20 20z" fill="#FFF"/>
    </svg>`
  },
  centos: {
    label: 'CentOS',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#A81D33"/>
      <path d="M30 40h40v20h-40z" fill="#FFF"/>
    </svg>`
  },
  fedora: {
    label: 'Fedora',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#294172"/>
      <path d="M35 35l30 30-10 10-30-30z" fill="#FFF"/>
    </svg>`
  },
  redhat: {
    label: 'Red Hat',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#EE0000"/>
      <path d="M50 25l15 15-15 15-15-15z" fill="#FFF"/>
    </svg>`
  },
  arch: {
    label: 'Arch Linux',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#1793D1"/>
      <text x="50" y="65" font-size="40" font-weight="bold" text-anchor="middle" fill="#FFF">A</text>
    </svg>`
  },
  linux: {
    label: 'Linux',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#FBB523"/>
      <circle cx="35" cy="40" r="5" fill="#333"/>
      <circle cx="65" cy="40" r="5" fill="#333"/>
      <path d="M35 60q15 15 30 0" stroke="#333" stroke-width="4" fill="none"/>
    </svg>`
  },

  // Others
  macos: {
    label: 'macOS',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#333"/>
      <path d="M65 35c2 0 4 1 4 3s-2 4-4 4-4-2-4-4 2-3 4-3zM45 35c2 0 4 1 4 3s-2 4-4 4-4-2-4-4 2-3 4-3zM55 55c3 0 6 2 6 5s-3 6-6 6-6-3-6-6 3-5 6-5z" fill="#FFF"/>
    </svg>`
  },
  default: {
    label: 'Other',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#666"/>
      <rect x="30" y="35" width="40" height="25" rx="2" fill="#FFF"/>
      <rect x="35" y="55" width="30" height="15" rx="1" fill="#999"/>
    </svg>`
  }
};

const OS_KEYWORDS: Record<string, string[]> = {
  windows: ['win', 'windows', 'vista', 'xp', '2000', 'nt'],
  'windows-11': ['win11', 'windows11', 'windows-11', 'win-11'],
  'windows-10': ['win10', 'windows10', 'windows-10', 'win-10'],
  'windows-server': ['server', '2019', '2022', '2016', '2012', '2008'],
  ubuntu: ['ubuntu', 'ubtu'],
  debian: ['debian', 'deb'],
  centos: ['centos', 'cent'],
  fedora: ['fedora', 'fdra'],
  redhat: ['redhat', 'rhel', 'red-hat'],
  arch: ['arch', 'archlinux'],
  linux: ['linux', 'lnx'],
  macos: ['macos', 'macosx', 'osx', 'mac']
};

function detectOS(imageName: string): string {
  const lowerName = imageName.toLowerCase();

  for (const [osKey, keywords] of Object.entries(OS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerName.includes(keyword)) {
        return osKey;
      }
    }
  }

  return 'default';
}

export function OSIcon({ imageName, size = 'md', className = '' }: OSIconProps) {
  const osKey = detectOS(imageName);
  const osData = OS_ICONS[osKey] || OS_ICONS.default;

  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-14 h-14'
  };

  return (
    <div
      className={`inline-flex items-center justify-center ${sizeClasses[size]} ${className}`}
      title={osData.label}
    >
      <div
        className="w-full h-full rounded-full shadow-sm overflow-hidden"
        dangerouslySetInnerHTML={{ __html: osData.svg }}
      />
    </div>
  );
}

export { detectOS };
