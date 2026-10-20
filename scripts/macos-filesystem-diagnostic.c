#include <sys/mount.h>
#include <sys/stat.h>
#include <stdio.h>
#include <stdint.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  struct statfs volume;
  struct stat entry;
  if (statfs(argv[1], &volume) != 0 || stat(argv[1], &entry) != 0) return 65;
  printf("%u\t%s\t%llu\t%llu\n", (unsigned) volume.f_type, volume.f_fstypename,
    (unsigned long long) entry.st_dev, (unsigned long long) entry.st_ino);
  return 0;
}
