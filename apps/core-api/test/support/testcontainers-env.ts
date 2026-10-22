// Em hosts com SELinux em modo Enforcing (Fedora), o Ryuk não acessa o docker.sock montado
// sem modo privilegiado ("permission denied"). O Ryuk já tem acesso total ao Docker pelo
// socket, então o modo privilegiado não amplia o que ele pode fazer.
process.env.TESTCONTAINERS_RYUK_PRIVILEGED ??= 'true';
